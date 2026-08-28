import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import type { CardRow } from "@/app/users/UserCard";
import { PAGE_SIZE } from "@/lib/userCards";

// /network is backed by two raw tables, `followers` and `following`, with no
// view or function over them. PostgREST cannot express the union, the mutual
// join, or the non-mutual anti-join that the feed is defined by, so those
// happen here instead - the SQL in the comments below is the query each step
// stands in for.
//
// This is affordable because the graph is small: ~3,000 edges over ~2,400
// accounts, fetched once per request and reused by all seven calls the page
// makes. What is NOT fetched for all of them is the post rollup and the vote;
// those are joined onto the twenty rows of the page only.
export { PAGE_SIZE };

/** Edge columns. Deliberately not `select *`: `raw` is the whole scraped user
 *  object, several KB a row, and nothing on the card reads it. */
const EDGE_COLUMNS =
  "owner_id,rest_id,screen_name,name,description,location,followers," +
  "following,tweets,protected,avatar_url,fetched_at";

/** PostgREST caps a response at 1,000 rows, so a full table is read in pages. */
const FETCH_PAGE = 1000;

type Edge = {
  owner_id: string;
  rest_id: string;
  screen_name: string | null;
  name: string | null;
  description: string | null;
  location: string | null;
  followers: number | null;
  following: number | null;
  tweets: number | null;
  protected: boolean | null;
  avatar_url: string | null;
  fetched_at: string;
};

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
 * Which pill is active. Followers and Following are not disjoint: a mutual has
 * a row in each table, so it counts under both. That is why Followers +
 * Following exceeds All by exactly the mutual count - and why Mutual is its
 * own pill rather than the arithmetic left over between the other two.
 *
 * Non-mutual is Mutual's other side, in the follower direction: Followers
 * minus Mutual, the accounts that follow the owner without a follow-back.
 */
export type RelationFilter =
  | "follower"
  | "following"
  | "mutual"
  | "non_mutual"
  | null;

const RELATIONS = ["follower", "following", "mutual", "non_mutual"] as const;

export function parseRelation(value: unknown): RelationFilter {
  return RELATIONS.includes(value as (typeof RELATIONS)[number])
    ? (value as RelationFilter)
    : null;
}

/** One whole direction:  select <cols> from <table> [where owner_id = ...] */
async function loadEdges(
  table: "followers" | "following",
  ownerId: string | null
): Promise<Edge[]> {
  const db = supabaseAdmin();
  const rows: Edge[] = [];

  for (let offset = 0; ; offset += FETCH_PAGE) {
    let q = db.from(table).select(EDGE_COLUMNS);
    if (ownerId) q = q.eq("owner_id", ownerId);

    // Ordered so the pages tile the table exactly rather than overlapping.
    const { data, error } = await q
      .order("rest_id", { ascending: true })
      .order("owner_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Edge[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

/** One account, with the profile fields plus which pills it belongs under. */
type Account = {
  profile: Omit<CardRow, "posts" | "total_views" | "avg_views" | "vote">;
  protected: boolean;
  follower: boolean;
  following: boolean;
  mutual: boolean;
  non_mutual: boolean;
};

/**
 * The whole graph for one owner (or for both, when ownerId is null), folded to
 * one entry per account.
 *
 * Direction membership is decided per owner and only then merged across
 * owners. That order matters once two graphs are loaded: an account can be a
 * mutual of one owner and a one-way follower of the other, and it belongs
 * under both pills - which is not what testing the merged sets would say.
 *
 * cache() dedupes this within a request, so the page's cards + five pill
 * counts + totals read the two tables once between them.
 */
const buildGraph = cache(async (ownerId: string | null): Promise<Account[]> => {
  const [followerEdges, followingEdges] = await Promise.all([
    loadEdges("followers", ownerId),
    loadEdges("following", ownerId),
  ]);

  // (rest_id -> owner_id -> directions), plus the freshest profile seen.
  const accounts = new Map<
    string,
    { owners: Map<string, { f: boolean; g: boolean }>; edge: Edge }
  >();

  const add = (edge: Edge, direction: "f" | "g") => {
    // The card renders from the account, not the edge, so a mutual's two
    // copies - scraped seconds apart - have to collapse to one. Freshest
    // wins, which is what `order by rest_id, fetched_at desc` picked.
    let entry = accounts.get(edge.rest_id);
    if (!entry) {
      entry = { owners: new Map(), edge };
      accounts.set(edge.rest_id, entry);
    } else if (edge.fetched_at > entry.edge.fetched_at) {
      entry.edge = edge;
    }

    let dirs = entry.owners.get(edge.owner_id);
    if (!dirs) entry.owners.set(edge.owner_id, (dirs = { f: false, g: false }));
    dirs[direction] = true;
  };

  for (const e of followerEdges) add(e, "f");
  for (const e of followingEdges) add(e, "g");

  const out: Account[] = [];
  for (const { owners, edge } of accounts.values()) {
    // Rows with no handle cannot be rendered or linked, and the old view
    // dropped them the same way.
    if (!edge.screen_name) continue;

    let follower = false;
    let following = false;
    let mutual = false;
    let nonMutual = false;
    for (const d of owners.values()) {
      follower ||= d.f;
      following ||= d.g;
      // Both directions for the SAME owner - the join on rest_id AND owner_id.
      mutual ||= d.f && d.g;
      // In followers with no matching following row for that owner: the
      // anti-join, which is Followers minus Mutual.
      nonMutual ||= d.f && !d.g;
    }

    out.push({
      profile: {
        rest_id: edge.rest_id,
        screen_name: edge.screen_name,
        name: edge.name,
        description: edge.description,
        location: edge.location,
        followers: edge.followers,
        following: edge.following,
        tweets: edge.tweets,
        // This actor reports neither, so both stay null and the card draws no
        // badge and no DMs-open pill rather than a false one.
        is_blue_verified: null,
        can_dm: null,
        avatar_url: edge.avatar_url,
      },
      protected: edge.protected ?? false,
      follower,
      following,
      mutual,
      non_mutual: nonMutual,
    });
  }

  // followers desc nulls last, then rest_id asc so a row can never appear on
  // two pages, or on none.
  out.sort(
    (a, b) =>
      (b.profile.followers ?? -1) - (a.profile.followers ?? -1) ||
      (a.profile.rest_id < b.profile.rest_id ? -1 : 1)
  );
  return out;
});

/** The graph narrowed to one pill. */
async function select(ownerId: string | null, relation: RelationFilter) {
  const accounts = await buildGraph(ownerId);
  return relation ? accounts.filter((a) => a[relation]) : accounts;
}

/**
 * Post rollup and vote for one page of accounts. Both are per-account features
 * that sit above either direction, so they join here rather than in the graph
 * - and only for the twenty rows about to be rendered.
 */
async function withRollups(accounts: Account[]): Promise<CardRow[]> {
  if (accounts.length === 0) return [];

  const db = supabaseAdmin();
  const ids = accounts.map((a) => a.profile.rest_id);

  const [posts, votes] = await Promise.all([
    db
      .from("user_posts_summary")
      .select("author_id,posts,total_views,avg_views")
      .in("author_id", ids),
    db.from("user_votes").select("user_id,liked,disliked").in("user_id", ids),
  ]);
  if (posts.error) throw new Error(posts.error.message);
  if (votes.error) throw new Error(votes.error.message);

  const byPosts = new Map(posts.data?.map((p) => [p.author_id, p]) ?? []);
  const byVote = new Map(votes.data?.map((v) => [v.user_id, v]) ?? []);

  return accounts.map((a) => {
    const p = byPosts.get(a.profile.rest_id);
    const v = byVote.get(a.profile.rest_id);
    return {
      ...a.profile,
      // Null until their tweets are scraped, which the UI renders as a dash
      // rather than a zero.
      posts: p?.posts ?? null,
      total_views: p?.total_views ?? null,
      avg_views: p?.avg_views ?? null,
      vote: v?.liked ? "like" : v?.disliked ? "dislike" : "none",
    } satisfies CardRow;
  });
}

/** One page of cards, ordered by followers like /users is. */
export async function loadSocialCards(
  ownerId: string | null,
  relation: RelationFilter,
  offset: number,
  limit: number
): Promise<CardRow[]> {
  const rows = await select(ownerId, relation);
  return withRollups(rows.slice(offset, offset + limit));
}

/** Header totals, over the current selection. */
export async function loadSocialTotals(
  ownerId: string | null,
  relation: RelationFilter
): Promise<Totals> {
  const rows = await select(ownerId, relation);
  return {
    profiles: rows.length,
    mutual: rows.filter((a) => a.mutual).length,
    protected: rows.filter((a) => a.protected).length,
    combined_reach: rows.reduce((sum, a) => sum + (a.profile.followers ?? 0), 0),
  };
}

/** Row counts for the filter pills. */
export async function loadSocialCounts(ownerId: string | null) {
  const accounts = await buildGraph(ownerId);
  return {
    all: accounts.length,
    follower: accounts.filter((a) => a.follower).length,
    following: accounts.filter((a) => a.following).length,
    mutual: accounts.filter((a) => a.mutual).length,
    non_mutual: accounts.filter((a) => a.non_mutual).length,
  };
}
