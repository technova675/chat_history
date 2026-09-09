import { supabaseAdmin } from "@/lib/supabase";
import type { CardRow } from "@/app/users/UserCard";

/** Columns the card needs. The view has already done every join. */
export const CARD_COLUMNS =
  "rest_id,screen_name,name,description,location,followers,following,tweets," +
  "is_blue_verified,can_dm,avatar_url,posts,total_views,avg_views,vote";

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
  "avg_views_desc",
  "avg_views_asc",
] as const;

export type SortKey = (typeof SORTS)[number];

export const DEFAULT_SORT: SortKey = "followers_desc";

export function parseSort(value: unknown): SortKey {
  return SORTS.includes(value as SortKey) ? (value as SortKey) : DEFAULT_SORT;
}

/** "avg_views_desc" -> the column and direction PostgREST wants. */
export function sortColumn(sort: SortKey): {
  column: "followers" | "total_views" | "avg_views";
  ascending: boolean;
} {
  const ascending = sort.endsWith("_asc");
  const column = sort.startsWith("followers")
    ? "followers"
    : sort.startsWith("total_views")
      ? "total_views"
      : "avg_views";
  return { column, ascending };
}

export type VoteFilter = "like" | "dislike" | "none" | null;

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

/** Header totals. An RPC because PostgREST can count rows but not sum them. */
export async function loadTotals(
  ownerId: string | null,
  vote: VoteFilter
): Promise<Totals> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .rpc("user_card_totals", { p_owner: ownerId, p_vote: vote })
    .single();

  if (error) throw new Error(error.message);
  return data as Totals;
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
