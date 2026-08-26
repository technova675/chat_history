import { supabaseAdmin } from "@/lib/supabase";
import type { CardRow } from "@/app/users/UserCard";

/** Columns the card needs. The view has already done every join. */
export const CARD_COLUMNS =
  "rest_id,screen_name,name,description,location,followers,following,tweets," +
  "is_blue_verified,can_dm,avatar_url,posts,total_views,avg_views,vote";

/** Rows per page: the server renders the first, /api/users serves the rest. */
export const PAGE_SIZE = 20;

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

/** One page of cards, ordered by followers like the original page was. */
export async function loadCards(
  ownerId: string | null,
  vote: VoteFilter,
  offset: number,
  limit: number
) {
  const { data, error } = await query(ownerId, vote)
    .order("followers", { ascending: false, nullsFirst: false })
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
