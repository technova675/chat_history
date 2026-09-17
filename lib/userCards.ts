import { supabaseAdmin } from "@/lib/supabase";
import { HIDDEN_ACCOUNT_IDS } from "@/lib/hiddenAccounts";
import type { CardRow } from "@/app/users/UserCard";

/** Columns the card needs. The view has already done every join. */
export const CARD_COLUMNS =
  "rest_id,screen_name,name,description,location,followers,following,tweets," +
  "is_blue_verified,can_dm,avatar_url,posts,total_views,median_views," +
  "max_views,vote,heygen,text_format";

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

/** Pre-joined once: this is ~7.7KB of URL and never changes at runtime. */
const HIDDEN_LIST = `(${HIDDEN_ACCOUNT_IDS.join(",")})`;

/** Shared filter, so the page and the paging route can never disagree. */
function query(ownerId: string | null, vote: VoteFilter, count = false) {
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
  sort: SortKey = DEFAULT_SORT
) {
  const { column, ascending } = sortColumn(sort);

  const { data, error } = await query(ownerId, vote)
    // nullsFirst: false in BOTH directions. An account with no scraped posts
    // has a null rollup, and null is not zero - it has not earned first place
    // on an ascending view sort, so it sorts last either way.
    .order(column, { ascending, nullsFirst: false })
    // rest_id breaks ties so a row can never appear on two pages, or none.
    .order("rest_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CardRow[];
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
  vote: VoteFilter
): Promise<Totals> {
  const totals: Totals = {
    profiles: 0,
    verified: 0,
    dm_open: 0,
    combined_reach: 0,
  };

  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await query(ownerId, vote)
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
  const [all, like, dislike, none] = await Promise.all(
    ([null, "like", "dislike", "none"] as VoteFilter[]).map(async (v) => {
      const { count, error } = await query(ownerId, v, true);
      if (error) throw new Error(error.message);
      return count ?? 0;
    })
  );
  return { all, like, dislike, none };
}
