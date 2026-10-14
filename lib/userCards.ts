import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import { HIDDEN_ACCOUNT_IDS } from "@/lib/hiddenAccounts";
import type { CardRow } from "@/app/users/UserCard";

/** Columns the card needs. The view has already done every join. */
export const CARD_COLUMNS =
  "rest_id,screen_name,name,description,location,followers,following,tweets," +
  "is_blue_verified,can_dm,avatar_url,posts,total_views,median_views," +
  "max_views,vote,heygen,text_format,personal,owner_ids";

/** Rows per page: the server renders the first, /api/users serves the rest. */
export const PAGE_SIZE = 20;

/**
 * Card order, shared by /users and /network so the two feeds offer the same
 * vocabulary. Followers comes off the profile; the two view sorts come from
 * the post rollup, which most accounts do not have yet - so this is also what
 * decides where the un-scraped ones land: last, in both directions.
 */
export const SORTS = [
  "followers_desc",
  "followers_asc",
  "total_views_desc",
  "total_views_asc",
  "median_views_desc",
  "median_views_asc",
] as const;

export type SortKey = (typeof SORTS)[number];

export const DEFAULT_SORT: SortKey = "followers_desc";

export function parseSort(value: unknown): SortKey {
  return SORTS.includes(value as SortKey) ? (value as SortKey) : DEFAULT_SORT;
}

/** "median_views_desc" -> the column and direction PostgREST wants. */
export function sortColumn(sort: SortKey): {
  column: "followers" | "total_views" | "median_views";
  ascending: boolean;
} {
  const ascending = sort.endsWith("_asc");
  const column = sort.startsWith("followers")
    ? "followers"
    : sort.startsWith("total_views")
      ? "total_views"
      : "median_views";
  return { column, ascending };
}

export type VoteFilter = "like" | "dislike" | "none" | null;

/**
 * `?filter=`, the pills that are not a vote. Common is accounts in two or more
 * owners' archives; the other three are the format flags from user_formats.
 * Exclusive with the vote pills: one pill is on at a time.
 */
export const EXTRA_FILTERS = ["common", "heygen", "text", "personal"] as const;

export type ExtraFilter = (typeof EXTRA_FILTERS)[number] | null;

export function parseExtraFilter(value: unknown): ExtraFilter {
  return EXTRA_FILTERS.includes(value as (typeof EXTRA_FILTERS)[number])
    ? (value as ExtraFilter)
    : null;
}

/** Format pill -> its user_cards column. */
const FORMAT_COLUMNS = {
  heygen: "heygen",
  text: "text_format",
  personal: "personal",
} as const;

/** Pre-joined once: this is ~7.7KB of URL and never changes at runtime. */
const HIDDEN_LIST = `(${HIDDEN_ACCOUNT_IDS.join(",")})`;

/**
 * Accounts in two or more archives. PostgREST cannot filter on an array's
 * length, so the ids are read here (one small column over ~900 rows, once per
 * request) and the feed is narrowed with rest_id=in.(...) instead.
 */
const loadCommonIds = cache(async (): Promise<string[]> => {
  const db = supabaseAdmin();
  const ids: string[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("user_cards")
      .select("rest_id,owner_ids")
      .order("rest_id", { ascending: true })
      .range(from, from + page - 1);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if ((row.owner_ids ?? []).length >= 2) ids.push(String(row.rest_id));
    }
    if (!data || data.length < page) return ids;
  }
});

/**
 * Shared filter, so the page and the paging route can never disagree.
 *
 * Synchronous on purpose, with the common ids passed in: the query builder is
 * a thenable, so an async version would run the query the moment it returned.
 * commonIds is only read when extra is "common".
 */
function query(
  ownerId: string | null,
  vote: VoteFilter,
  extra: ExtraFilter,
  commonIds: string[],
  count = false
) {
  const db = supabaseAdmin();
  let q = count
    ? // One id column and one row: enough to carry the exact count back in
      // the content-range header. Not head:true - a bodyless HEAD response
      // surfaces as an error with an empty message under Next's fetch.
      db.from("user_cards").select("rest_id", { count: "exact" }).limit(1)
    : db.from("user_cards").select(CARD_COLUMNS);

  // owner_ids is an array: one card can belong to several archives.
  if (ownerId) q = q.contains("owner_ids", [ownerId]);
  if (vote) q = q.eq("vote", vote);
  if (extra === "common") {
    // "-" matches no rest_id, so an empty list yields no rows rather than a
    // malformed in.() filter.
    q = q.in("rest_id", commonIds.length > 0 ? commonIds : ["-"]);
  } else if (extra) {
    q = q.eq(FORMAT_COLUMNS[extra], true);
  }

  // Holds the feed at the 482 accounts it showed before the 2026-09-17
  // profile sweep. See lib/hiddenAccounts.ts for why these rows are sound
  // data that is nonetheless not displayed.
  if (HIDDEN_ACCOUNT_IDS.length > 0) q = q.not("rest_id", "in", HIDDEN_LIST);
  return q;
}

/** One page of cards, in the requested order. */
export async function loadCards(
  ownerId: string | null,
  vote: VoteFilter,
  offset: number,
  limit: number,
  sort: SortKey = DEFAULT_SORT,
  extra: ExtraFilter = null
): Promise<CardRow[]> {
  const { column, ascending } = sortColumn(sort);

  const commonIds = extra === "common" ? await loadCommonIds() : [];

  const { data, error } = await query(ownerId, vote, extra, commonIds)
    // nullsFirst: false in BOTH directions. An account with no scraped posts
    // has a null rollup, and null is not zero - it has not earned first place
    // on an ascending view sort, so it sorts last either way.
    .order(column, { ascending, nullsFirst: false })
    // rest_id breaks ties so a row can never appear on two pages, or none.
    .order("rest_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  // owner_ids only travels as far as the badge; the card does not need it.
  const rows = (data ?? []) as unknown as (CardRow & {
    owner_ids: string[] | null;
  })[];
  return rows.map(({ owner_ids, ...row }) => ({
    ...row,
    common: (owner_ids ?? []).length >= 2,
  }));
}

export type Totals = {
  profiles: number;
  verified: number;
  dm_open: number;
  combined_reach: number;
};

/**
 * Header totals.
 *
 * Was an RPC, because PostgREST can count rows but not sum them. The RPC
 * reads user_cards directly and so cannot see the hidden-account filter,
 * which would leave the header claiming 923 profiles above a feed of 482.
 * Summing four small columns over the filtered rows in JS keeps the header
 * and the cards telling the same story, which matters more here than saving
 * one round trip. Move this back to SQL if the feed ever outgrows a few
 * thousand rows - or run supabase/feed_enabled.sql, which puts the filter in
 * the view and makes user_card_totals correct again on its own.
 */
export async function loadTotals(
  ownerId: string | null,
  vote: VoteFilter,
  extra: ExtraFilter = null
): Promise<Totals> {
  const totals: Totals = {
    profiles: 0,
    verified: 0,
    dm_open: 0,
    combined_reach: 0,
  };
  const commonIds = extra === "common" ? await loadCommonIds() : [];

  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await query(ownerId, vote, extra, commonIds)
      .select("is_blue_verified,can_dm,followers")
      .range(from, from + page - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      is_blue_verified: boolean | null;
      can_dm: boolean | null;
      followers: number | null;
    }[];

    for (const row of rows) {
      totals.profiles++;
      if (row.is_blue_verified) totals.verified++;
      if (row.can_dm) totals.dm_open++;
      totals.combined_reach += row.followers ?? 0;
    }
    if (rows.length < page) break;
  }
  return totals;
}

/** Row counts for the filter pills. head:true, so no rows travel. */
export async function loadCounts(ownerId: string | null) {
  const commonIds = await loadCommonIds();
  const countOf = async (vote: VoteFilter, extra: ExtraFilter) => {
    const { count, error } = await query(ownerId, vote, extra, commonIds, true);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [all, like, dislike, none, common, heygen, text, personal] =
    await Promise.all([
      countOf(null, null),
      countOf("like", null),
      countOf("dislike", null),
      countOf("none", null),
      countOf(null, "common"),
      countOf(null, "heygen"),
      countOf(null, "text"),
      countOf(null, "personal"),
    ]);
  return { all, like, dislike, none, common, heygen, text, personal };
}
