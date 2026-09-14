import { supabaseAdmin } from "@/lib/supabase";
import { toPostRows, type ApifyTweet } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 1000;

const ACTOR = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest";

/** Whose follow graph is scraped when no ?owner= is given. */
const DEFAULT_OWNER = "3018488785";

/**
 * Actor input. Identical to /api/posts/scrape except for the window: this
 * sweep reaches further back and further forward, so accounts that were quiet
 * inside the DM sweep's narrower range still return posts.
 */
const ACTOR_INPUT = {
  "filter:blue_verified": false,
  "filter:consumer_video": false,
  "filter:has_engagement": false,
  "filter:hashtags": false,
  "filter:images": false,
  "filter:links": false,
  "filter:media": false,
  "filter:mentions": false,
  "filter:native_video": false,
  "filter:nativeretweets": false,
  "filter:news": false,
  "filter:pro_video": false,
  "filter:quote": false,
  "filter:replies": false,
  "filter:safe": false,
  "filter:spaces": false,
  "filter:twimg": false,
  "filter:videos": false,
  "filter:vine": false,
  "include:nativeretweets": false,
  lang: "en",
  maxItems: 20,
  queryType: "Latest",
  since_time: "1767245400",
  until_time: "1789064940",
  min_retweets: 0,
  min_faves: 0,
  min_replies: 0,
  "-min_retweets": 0,
  "-min_faves": 0,
  "-min_replies": 0,
} as const;

/** PostgREST caps a response at 1,000 rows, so a full table is read in pages. */
const FETCH_PAGE = 1000;

type Edge = {
  rest_id: string;
  screen_name: string | null;
  followers: number | null;
  protected: boolean | null;
};

/**
 * One direction of the graph for one owner, paged past the row ceiling.
 * Ordered by rest_id so the pages tile the table rather than overlapping.
 */
async function loadEdges(
  table: "followers" | "following",
  ownerId: string
): Promise<Edge[]> {
  const db = supabaseAdmin();
  const rows: Edge[] = [];

  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await db
      .from(table)
      .select("rest_id,screen_name,followers,protected")
      .eq("owner_id", ownerId)
      .order("rest_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(`reading ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Edge[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

/** Handles that already have rows, lowercased - X handles are case-insensitive. */
async function loadScraped(): Promise<Set<string>> {
  const db = supabaseAdmin();
  const out = new Set<string>();

  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await db
      .from("user_posts")
      .select("author_username")
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(`reading user_posts: ${error.message}`);
    for (const row of data ?? []) {
      const name = (row as { author_username: string | null }).author_username;
      if (name) out.add(name.toLowerCase());
    }
    if (!data || data.length < FETCH_PAGE) return out;
  }
}

type Candidate = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
};

/**
 * The owner's non-mutual followers, in scrape order. Stands in for:
 *
 *   select f.rest_id, f.screen_name, f.followers
 *   from followers f
 *   where f.owner_id = $1
 *     and f.screen_name is not null
 *     and coalesce(f.protected, false) = false
 *     and not exists (
 *       select 1 from following g
 *       where g.rest_id = f.rest_id and g.owner_id = f.owner_id
 *     )
 *   order by f.followers desc nulls last, f.rest_id;
 *
 * Non-mutual, not mutual: they follow the owner, the owner does not follow
 * back. That is the side of the graph with no post rows yet.
 *
 * PostgREST cannot express that anti-join, so both directions are read and
 * subtracted here. Protected accounts are dropped: the actor returns nothing
 * for a locked timeline, so running one is spend with no row to show for it.
 *
 * The rollup is deliberately not joined for the ordering. Every account in
 * this queue is one with no posts stored, so total_views is null across the
 * board and `order by total_views desc nulls last` collapses to the follower
 * count - which is what this sorts by directly.
 */
async function loadNonMutuals(ownerId: string): Promise<Candidate[]> {
  const [followerEdges, followingEdges] = await Promise.all([
    loadEdges("followers", ownerId),
    loadEdges("following", ownerId),
  ]);

  const followedBack = new Set(followingEdges.map((e) => e.rest_id));
  const byId = new Map<string, Candidate>();

  for (const e of followerEdges) {
    if (followedBack.has(e.rest_id)) continue;
    if (!e.screen_name) continue;
    if (e.protected) continue;
    // A repeated scrape pass can leave two rows for one account; one card,
    // one actor run, so the first wins.
    if (!byId.has(e.rest_id)) {
      byId.set(e.rest_id, {
        rest_id: e.rest_id,
        screen_name: e.screen_name,
        followers: e.followers,
      });
    }
  }

  return [...byId.values()].sort(
    (a, b) =>
      (b.followers ?? -1) - (a.followers ?? -1) ||
      (a.rest_id < b.rest_id ? -1 : 1)
  );
}

/** One synchronous actor run for one handle. */
async function runActor(screenName: string): Promise<ApifyTweet[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be set in .env.local");

  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ACTOR_INPUT,
        twitterContent: `from:${screenName} -filter:replies`,
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/** GET /api/network/scrape - the work queue. No actor runs, no charges. */
export async function GET(request: Request) {
  try {
    const ownerId =
      new URL(request.url).searchParams.get("owner") ?? DEFAULT_OWNER;

    const [candidates, scraped] = await Promise.all([
      loadNonMutuals(ownerId),
      loadScraped(),
    ]);
    const pending = candidates.filter(
      (c) => !scraped.has(c.screen_name.toLowerCase())
    );

    return Response.json({
      ownerId,
      total: candidates.length,
      done: candidates.length - pending.length,
      remaining: pending.length,
      maxItems: ACTOR_INPUT.maxItems,
      pending,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/network/scrape { screenName }
 *
 * One handle: run the actor, upsert what comes back into user_posts, return
 * the counts. The rollups - user_posts_summary and network_posts_summary -
 * are views computed over that table, so the card numbers follow with no
 * second write.
 *
 * The browser drives the loop, so each call is a single billable actor run
 * and the tab can be closed between any two of them without losing work.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let screenName = "";

  try {
    const body = await request.json().catch(() => ({}));
    screenName = String(body?.screenName ?? "").trim();
    if (!screenName) {
      return Response.json({ error: "screenName is required" }, { status: 400 });
    }

    const tweets = await runActor(screenName);
    const { rows, skipped, duplicates } = toPostRows(tweets);

    if (rows.length > 0) {
      const db = supabaseAdmin();
      const { error } = await db
        .from("user_posts")
        .upsert(rows, { onConflict: "tweet_id" });
      if (error) throw new Error(`writing user_posts: ${error.message}`);
    }

    return Response.json({
      screenName,
      returned: tweets.length,
      imported: rows.length,
      skipped,
      duplicates,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return Response.json(
      {
        screenName,
        error: (err as Error).message,
        elapsedMs: Date.now() - started,
      },
      { status: 500 }
    );
  }
}
