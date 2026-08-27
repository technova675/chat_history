import { supabaseAdmin } from "@/lib/supabase";
import type { CardRow } from "@/app/users/UserCard";
import { PAGE_SIZE } from "@/lib/userCards";

// social_cards carries the same card columns as user_cards on purpose, so
// /network reuses the card component and its page size unchanged. The column
// list is its own, though: this feed is backed by social_accounts, a table
// entirely separate from the DM-side user_info.
export { PAGE_SIZE };

export const CARD_COLUMNS =
  "rest_id,screen_name,name,description,location,followers,following,tweets," +
  "is_blue_verified,can_dm,avatar_url,posts,total_views,avg_views,vote";

/**
 * Header totals. Not the same four as /users: the follower actor reports
 * neither the blue badge nor DM permission, so counting them would render an
 * absence as a zero. Mutuals and protected accounts are things it does know.
 */
export type Totals = {
  profiles: number;
  mutual: number;
  protected: number;
  combined_reach: number;
};

/**
 * Which pill is active. Followers and Following are not disjoint: a mutual
 * follows the owner AND is followed by them, so it counts under both. That is
 * why Followers + Following (947 + 382) exceeds All (1,147) by exactly the
 * 182 mutuals - and why Mutual is its own pill rather than the arithmetic
 * left over between the other two.
 */
export type RelationFilter = "follower" | "following" | "mutual" | null;

export function parseRelation(value: unknown): RelationFilter {
  return value === "follower" || value === "following" || value === "mutual"
    ? value
    : null;
}

/** Shared filter, so the page and the paging route can never disagree. */
function query(ownerId: string | null, relation: RelationFilter, count = false) {
  const db = supabaseAdmin();
  let q = count
    ? // One id column and one row: enough to carry the exact count back in
      // the content-range header. Not head:true, for the same reason as in
      // lib/userCards.ts - a bodyless HEAD surfaces as an empty-message error.
      db.from("social_cards").select("rest_id", { count: "exact" }).limit(1)
    : db.from("social_cards").select(CARD_COLUMNS);

  // Owner and direction have to be tested as one pair: an account can follow
  // one owner while being followed by another, and filtering separately would
  // match that account under a combination it never had. The view pre-splits
  // the owners by direction, with mutuals counted into both, so each case is
  // a single array test rather than an or-clause.
  const ownersInDirection = {
    follower: "follower_owner_ids",
    following: "following_owner_ids",
    mutual: "mutual_owner_ids",
  } as const;

  if (ownerId && relation) {
    q = q.contains(ownersInDirection[relation], [ownerId]);
  } else if (ownerId) {
    q = q.contains("owner_ids", [ownerId]);
  } else if (relation === "mutual") {
    q = q.contains("relations", ["mutual"]);
  } else if (relation) {
    // overlaps, not contains: a mutual carries only "mutual" in relations,
    // yet belongs under both the Followers and the Following pill.
    q = q.overlaps("relations", [relation, "mutual"]);
  }
  return q;
}

/** One page of cards, ordered by followers like /users is. */
export async function loadSocialCards(
  ownerId: string | null,
  relation: RelationFilter,
  offset: number,
  limit: number
) {
  const { data, error } = await query(ownerId, relation)
    .order("followers", { ascending: false, nullsFirst: false })
    // rest_id breaks ties so a row can never appear on two pages, or none.
    .order("rest_id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CardRow[];
}

/** Header totals. An RPC because PostgREST can count rows but not sum them. */
export async function loadSocialTotals(
  ownerId: string | null,
  relation: RelationFilter
): Promise<Totals> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .rpc("social_card_totals", { p_owner: ownerId, p_relation: relation })
    .single();

  if (error) throw new Error(error.message);
  return data as Totals;
}

/** Row counts for the filter pills. */
export async function loadSocialCounts(ownerId: string | null) {
  const [all, follower, following, mutual] = await Promise.all(
    ([null, "follower", "following", "mutual"] as RelationFilter[]).map(
      async (r) => {
        const { count, error } = await query(ownerId, r, true);
        if (error) throw new Error(error.message);
        return count ?? 0;
      }
    )
  );
  return { all, follower, following, mutual };
}
