import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase";
import type { CardRow } from "@/app/users/UserCard";
import {
  PAGE_SIZE,
  DEFAULT_SORT,
  choicesFor,
  parseSort,
  type OwnerChoices,
  type SortKey,
} from "@/lib/userCards";

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
export { PAGE_SIZE, DEFAULT_SORT, parseSort };
export type { SortKey };

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
 *
 * Common is across owners rather than within one: the account follows two or
 * more owners (vir and sim) - it is in each one's followers list. Accounts the
 * owners follow do not count.
 *
 * HeyGen, Text and Personal are the format flags from user_formats, the same
 * ones the buttons on the card toggle.
 */
export type RelationFilter =
  | "follower"
  | "following"
  | "mutual"
  | "non_mutual"
  | "common"
  | "heygen"
  | "text"
  | "personal"
  | null;

const RELATIONS = [
  "follower",
  "following",
  "mutual",
  "non_mutual",
  "common",
  "heygen",
  "text",
  "personal",
] as const;

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
  profile: Omit<
    CardRow,
    | "posts"
    | "total_views"
    | "median_views"
    | "max_views"
    | "last_fetched_at"
    | "vote"
    | "heygen"
    | "text_format"
    | "personal"
    | "acted_by"
    | "choices"
  >;
  protected: boolean;
  /** Owners whose graph the account is in, either direction. */
  owner_ids: string[];
  follower: boolean;
  following: boolean;
  mutual: boolean;
  non_mutual: boolean;
  common: boolean;
  heygen: boolean;
  text: boolean;
  personal: boolean;
};

type Formats = { heygen: boolean; text_format: boolean; personal: boolean };

/**
 * Every account with at least one format flag on. Only those rows: no row, or
 * a row with every flag off, both mean nothing has been picked. The pills need
 * the whole graph's flags, not just the page's, so this cannot wait for
 * withRollups.
 *
 * The selected owner's own picks, or either owner's on "All".
 * Rows from before picks were per owner have no owner_id and count for nobody.
 */
const loadFormatIndex = cache(
  async (actor: string | null): Promise<Map<string, Formats>> => {
    const db = supabaseAdmin();
    const out = new Map<string, Formats>();

    for (let offset = 0; ; offset += FETCH_PAGE) {
      let q = db
        .from("user_formats")
        .select("user_id,owner_id,heygen,text_format,personal")
        .or("heygen.eq.true,text_format.eq.true,personal.eq.true")
        .not("owner_id", "is", null);
      if (actor) q = q.eq("owner_id", actor);

      const { data, error } = await q
        .order("user_id", { ascending: true })
        .order("owner_id", { ascending: true })
        .range(offset, offset + FETCH_PAGE - 1);

      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        // Both owners' rows fold to one: a format is on if either picked it.
        const id = String(row.user_id);
        const prev = out.get(id);
        out.set(id, {
          heygen: row.heygen || (prev?.heygen ?? false),
          text_format: row.text_format || (prev?.text_format ?? false),
          personal: row.personal || (prev?.personal ?? false),
        });
      }
      if (!data || data.length < FETCH_PAGE) return out;
    }
  }
);

type Rollup = {
  posts: number | null;
  total_views: number | null;
  median_views: number | null;
  last_fetched_at: string | null;
};

/**
 * Post rollup for EVERY account, keyed by author_id.
 *
 * withRollups reads twenty rows because that is all a page renders. Sorting
 * by views cannot: the twenty rows to render are not known until the whole
 * selection has been ordered, and buildGraph needs every account's post count
 * to drop the ones with none. cache() keeps this to one read per request even
 * though the page calls the loaders several times.
 */
const loadRollupIndex = cache(async (): Promise<Map<string, Rollup>> => {
  const db = supabaseAdmin();
  const out = new Map<string, Rollup>();

  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await db
      .from("user_posts_summary")
      .select("author_id,posts,total_views,median_views,last_fetched_at")
      .order("author_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      out.set(String(row.author_id), {
        posts: row.posts,
        total_views: row.total_views,
        median_views: row.median_views,
        last_fetched_at: row.last_fetched_at,
      });
    }
    if (!data || data.length < FETCH_PAGE) return out;
  }
});

/**
 * The whole graph for one owner (or for both, when ownerId is null), folded to
 * one entry per account.
 *
 * Direction membership is decided per owner and only then merged across
 * owners. That order matters once two graphs are loaded: an account can be a
 * mutual of one owner and a one-way follower of the other, and it belongs
 * under both pills - which is not what testing the merged sets would say.
 *
 * cache() dedupes this within a request, so the page's cards + six pill
 * counts + totals read the two tables once between them.
 *
 * `common` needs every owner's edges, so a single-owner graph also builds the
 * all-owners one to look it up - the graph is small enough that this is cheap.
 *
 * actor only decides the format flags: the HeyGen / Text / Personal pills are
 * the selected owner's own picks.
 */
const buildGraph = cache(async (
  ownerId: string | null,
  actor: string | null
): Promise<Account[]> => {
  const [followerEdges, followingEdges, formats, rollups] = await Promise.all([
    loadEdges("followers", ownerId),
    loadEdges("following", ownerId),
    loadFormatIndex(actor),
    loadRollupIndex(),
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

  const commonIds = ownerId
    ? new Set(
        (await buildGraph(null, actor))
          .filter((a) => a.common)
          .map((a) => a.profile.rest_id)
      )
    : null;

  const out: Account[] = [];
  for (const { owners, edge } of accounts.values()) {
    // Rows with no handle cannot be rendered or linked, and the old view
    // dropped them the same way.
    if (!edge.screen_name) continue;
    // Only accounts with scraped posts; no rollup row means none yet.
    if (!((rollups.get(edge.rest_id)?.posts ?? 0) > 0)) continue;

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

    // Followers only: an owner merely following the account does not count.
    let followedOwners = 0;
    for (const d of owners.values()) if (d.f) followedOwners++;
    const common = commonIds
      ? commonIds.has(edge.rest_id)
      : followedOwners >= 2;

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
        common,
      },
      protected: edge.protected ?? false,
      owner_ids: [...owners.keys()],
      follower,
      following,
      mutual,
      non_mutual: nonMutual,
      common,
      heygen: formats.get(edge.rest_id)?.heygen ?? false,
      text: formats.get(edge.rest_id)?.text_format ?? false,
      personal: formats.get(edge.rest_id)?.personal ?? false,
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
async function select(
  ownerId: string | null,
  relation: RelationFilter,
  actor: string | null
) {
  const accounts = await buildGraph(ownerId, actor);
  return relation ? accounts.filter((a) => a[relation]) : accounts;
}

/**
 * Post rollup and votes for one page of accounts. Both are per-account
 * features that sit above either direction, so they join here rather than in
 * the graph - and only for the twenty rows about to be rendered.
 *
 * Votes and format picks are read for both owners: the buttons show the
 * selected owner's own (both combined on "All"), the V / S badges show who
 * has made any.
 */
async function withRollups(
  accounts: Account[],
  actor: string | null
): Promise<CardRow[]> {
  if (accounts.length === 0) return [];

  const db = supabaseAdmin();
  const ids = accounts.map((a) => a.profile.rest_id);

  const [posts, votes, formats] = await Promise.all([
    db
      .from("user_posts_summary")
      .select("author_id,posts,total_views,median_views,max_views,last_fetched_at")
      .in("author_id", ids),
    db
      .from("user_votes")
      .select("user_id,owner_id,liked,disliked")
      .in("user_id", ids)
      .not("owner_id", "is", null),
    db
      .from("user_formats")
      .select("user_id,owner_id,heygen,text_format,personal")
      .in("user_id", ids)
      .not("owner_id", "is", null),
  ]);
  if (posts.error) throw new Error(posts.error.message);
  if (votes.error) throw new Error(votes.error.message);
  if (formats.error) throw new Error(formats.error.message);

  const byPosts = new Map(posts.data?.map((p) => [p.author_id, p]) ?? []);

  // No row means nobody has voted or picked a format yet: every list empty.
  const choices = new Map<string, OwnerChoices>();
  const choicesOf = (id: string) => {
    let c = choices.get(id);
    if (!c) {
      c = { liked_by: [], disliked_by: [], heygen_by: [], text_by: [], personal_by: [] };
      choices.set(id, c);
    }
    return c;
  };
  for (const v of votes.data ?? []) {
    const c = choicesOf(String(v.user_id));
    if (v.liked) c.liked_by.push(v.owner_id);
    if (v.disliked) c.disliked_by.push(v.owner_id);
  }
  for (const f of formats.data ?? []) {
    const c = choicesOf(String(f.user_id));
    if (f.heygen) c.heygen_by.push(f.owner_id);
    if (f.text_format) c.text_by.push(f.owner_id);
    if (f.personal) c.personal_by.push(f.owner_id);
  }

  return accounts.map((a) => {
    const p = byPosts.get(a.profile.rest_id);
    return {
      ...a.profile,
      // Null until their tweets are scraped, which the UI renders as a dash
      // rather than a zero.
      posts: p?.posts ?? null,
      total_views: p?.total_views ?? null,
      median_views: p?.median_views ?? null,
      max_views: p?.max_views ?? null,
      last_fetched_at: p?.last_fetched_at ?? null,
      ...choicesFor(choicesOf(a.profile.rest_id), actor),
    } satisfies CardRow;
  });
}

/**
 * The selection in card order.
 *
 * Un-scraped accounts have no rollup row, and null is not zero: an account
 * whose tweets were never fetched has not earned last place on an ascending
 * view sort. They sort to the end in BOTH directions, the way `nulls last`
 * would, so the accounts with real numbers stay together at the top.
 *
 * rest_id breaks every tie, so a row can never appear on two pages or on none
 * as the grid scrolls.
 */
async function sortAccounts(
  accounts: Account[],
  sort: SortKey
): Promise<Account[]> {
  if (sort === "followers_desc") return accounts; // buildGraph's own order

  const rows = [...accounts];

  if (sort === "followers_asc") {
    return rows.sort(
      (a, b) =>
        (a.profile.followers ?? Infinity) - (b.profile.followers ?? Infinity) ||
        (a.profile.rest_id < b.profile.rest_id ? -1 : 1)
    );
  }

  const index = await loadRollupIndex();
  const field = sort.startsWith("total_views")
    ? "total_views"
    : "median_views";
  const ascending = sort.endsWith("_asc");
  const valueOf = (a: Account) => index.get(a.profile.rest_id)?.[field] ?? null;

  return rows.sort((a, b) => {
    const x = valueOf(a);
    const y = valueOf(b);
    if (x === null && y === null) {
      return a.profile.rest_id < b.profile.rest_id ? -1 : 1;
    }
    if (x === null) return 1;
    if (y === null) return -1;
    return (
      (ascending ? x - y : y - x) ||
      (a.profile.rest_id < b.profile.rest_id ? -1 : 1)
    );
  });
}

/** One page of cards, in the requested order. */
export async function loadSocialCards(
  ownerId: string | null,
  relation: RelationFilter,
  offset: number,
  limit: number,
  sort: SortKey = DEFAULT_SORT,
  actor: string | null = null
): Promise<CardRow[]> {
  const rows = await sortAccounts(await select(ownerId, relation, actor), sort);
  return withRollups(rows.slice(offset, offset + limit), actor);
}

/** Header totals, over the current selection. */
export async function loadSocialTotals(
  ownerId: string | null,
  relation: RelationFilter,
  actor: string | null = null
): Promise<Totals> {
  const rows = await select(ownerId, relation, actor);
  return {
    profiles: rows.length,
    mutual: rows.filter((a) => a.mutual).length,
    protected: rows.filter((a) => a.protected).length,
    combined_reach: rows.reduce((sum, a) => sum + (a.profile.followers ?? 0), 0),
  };
}

/** Row counts for the filter pills. */
export async function loadSocialCounts(
  ownerId: string | null,
  actor: string | null = null
) {
  const accounts = await buildGraph(ownerId, actor);
  return {
    all: accounts.length,
    follower: accounts.filter((a) => a.follower).length,
    following: accounts.filter((a) => a.following).length,
    mutual: accounts.filter((a) => a.mutual).length,
    non_mutual: accounts.filter((a) => a.non_mutual).length,
    common: accounts.filter((a) => a.common).length,
    heygen: accounts.filter((a) => a.heygen).length,
    text: accounts.filter((a) => a.text).length,
    personal: accounts.filter((a) => a.personal).length,
  };
}

/**
 * How far each owner's post data reaches: the latest fetch over the accounts
 * in their graph, keyed by owner_id. Just the selected owner's, or every
 * owner's on "All".
 *
 *   select owner_id, max(s.last_fetched_at)
 *   from <graph> join user_posts_summary s on s.author_id = rest_id
 *   group by owner_id
 */
export async function loadFetchDates(
  ownerId: string | null,
  actor: string | null = null
): Promise<Map<string, string>> {
  const [accounts, rollups] = await Promise.all([
    buildGraph(ownerId, actor),
    loadRollupIndex(),
  ]);

  const out = new Map<string, string>();
  for (const a of accounts) {
    const at = rollups.get(a.profile.rest_id)?.last_fetched_at;
    if (!at) continue;
    for (const owner of a.owner_ids) {
      const prev = out.get(owner);
      if (!prev || Date.parse(at) > Date.parse(prev)) out.set(owner, at);
    }
  }
  return out;
}
