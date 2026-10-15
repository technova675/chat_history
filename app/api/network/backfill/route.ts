import { supabaseAdmin } from "@/lib/supabase";
import { toPostRows, type ApifyTweet, type PostRow } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 250;

const ACTOR = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest";

/**
 * The first-touch sweep for ACTIVE, never-scraped accounts.
 *
 * Sibling of /api/network/refill, and deliberately its own route: that queue is
 * "scraped but thin" (an inner join to the rollup), this one is "no rollup row
 * at all" (an anti-join), and this one alone filters what it stores by year.
 *
 * The year gate is the difference that matters. The actor's `Latest` query
 * returns an account's most recent twenty posts whatever their age, and an
 * account that stopped posting in 2023 would otherwise fill user_posts with
 * three-year-old tweets whose engagement numbers say nothing about how it
 * performs now. Those results are still bought - Apify bills per result, and
 * the filter runs after the response - but they are not stored.
 */

/** Whose graph the queue is drawn from. Overridable with ?owner=. */
const DEFAULT_OWNER = "958230722292064256";

/** Only posts from this calendar year (UTC) are written. */
const KEEP_YEAR = 2026;

/** Accounts above this follower count are out of scope for the sweep. */
const FOLLOWER_CEILING = 100_000;

/** Below this lifetime tweet count an account is too quiet to be worth a run. */
const TWEET_FLOOR = 500;

/** Posts requested per handle. */
const MAX_ITEMS = 20;

/**
 * Actor input. One handle per run: `from` is the whole query, so every one of
 * the twenty results is that account's - a batch of 25 splits its twenty
 * results across the batch and short-changes each individual.
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
  maxItems: MAX_ITEMS,
  queryType: "Latest",
} as const;

/** PostgREST caps a response at 1,000 rows, so a full table is read in pages. */
const FETCH_PAGE = 1000;

/** How many ids one `.in(...)` filter carries. Keeps the URL under its limit. */
const IN_CHUNK = 200;

type Edge = {
  rest_id: string;
  screen_name: string | null;
  followers: number | null;
  tweets: number | null;
  protected: boolean | null;
  fetched_at: string;
};

/** One direction of the graph for one owner, paged past the row ceiling. */
async function loadEdges(
  table: "followers" | "following",
  ownerId: string
): Promise<Edge[]> {
  const db = supabaseAdmin();
  const rows: Edge[] = [];

  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await db
      .from(table)
      .select("rest_id,screen_name,followers,tweets,protected,fetched_at")
      .eq("owner_id", ownerId)
      .order("rest_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(`reading ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Edge[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

/** Which of these ids already have a rollup row - i.e. have been scraped. */
async function loadScrapedIds(ids: string[]): Promise<Set<string>> {
  const db = supabaseAdmin();
  const out = new Set<string>();

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("user_posts_summary")
      .select("author_id")
      .in("author_id", ids.slice(i, i + IN_CHUNK));

    if (error) throw new Error(`reading user_posts_summary: ${error.message}`);
    for (const row of data ?? []) out.add(String(row.author_id));
  }
  return out;
}

export type Candidate = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
  tweets: number | null;
};

/**
 * The queue. Stands in for:
 *
 *   with edges as (
 *     select ... from followers where owner_id = $1
 *     union all
 *     select ... from following where owner_id = $1
 *   ),
 *   accounts as (
 *     select rest_id,
 *            (array_agg(screen_name order by fetched_at desc))[1] as screen_name,
 *            (array_agg(followers   order by fetched_at desc))[1] as followers,
 *            (array_agg(tweets      order by fetched_at desc))[1] as tweets
 *       from edges group by rest_id
 *   )
 *   select a.*
 *     from accounts a
 *     left join user_posts_summary s on s.author_id = a.rest_id
 *    where a.screen_name is not null
 *      and a.followers < 100000
 *      and s.posts is null
 *      and a.tweets  > 500
 *    order by s.median_views desc nulls last, a.rest_id;
 *
 * PostgREST cannot express the union or the per-owner fold, so both directions
 * are read and merged here. Freshest edge wins for the profile fields, the
 * same way the /network cards resolve a mutual's two rows.
 *
 * On the ordering: every row here has `s.posts is null`, so median_views is
 * null across the board and the SQL's first key does nothing - it collapses to
 * rest_id. Sorting by lifetime tweet count instead puts the most active
 * accounts first, which is the intent that key was standing in for.
 */
async function loadQueue(ownerId: string): Promise<Candidate[]> {
  const [followerEdges, followingEdges] = await Promise.all([
    loadEdges("followers", ownerId),
    loadEdges("following", ownerId),
  ]);

  const byId = new Map<string, Edge>();
  for (const e of [...followerEdges, ...followingEdges]) {
    const seen = byId.get(e.rest_id);
    if (!seen || e.fetched_at > seen.fetched_at) byId.set(e.rest_id, e);
  }

  // Narrow before the rollup read: no point asking about accounts the
  // follower ceiling or the tweet floor has already ruled out.
  const eligible = [...byId.values()].filter(
    (e) =>
      e.screen_name &&
      // null is unknown, not small - same as `a.followers < 100000`, which a
      // null never satisfies. Likewise `a.tweets > 500`.
      e.followers !== null &&
      e.followers < FOLLOWER_CEILING &&
      e.tweets !== null &&
      e.tweets > TWEET_FLOOR
  );

  const scraped = await loadScrapedIds(eligible.map((e) => e.rest_id));

  return eligible
    .filter((e) => !scraped.has(e.rest_id)) // s.posts is null
    .map((e) => ({
      rest_id: e.rest_id,
      screen_name: e.screen_name as string,
      followers: e.followers,
      tweets: e.tweets,
    }))
    .sort(
      (a, b) =>
        (b.tweets ?? -1) - (a.tweets ?? -1) ||
        (a.rest_id < b.rest_id ? -1 : 1)
    );
}

/** One synchronous actor run for one handle. */
async function runActor(screenName: string): Promise<ApifyTweet[]> {
  // Second Apify account only, shared with /network/scrape2. No fallback to
  // APIFY_TOKEN: that token belongs to the refill tab, and borrowing it would
  // put two sweeps on one account's concurrent-run cap.
  const token = process.env.APIFY_TOKEN_2;
  if (!token) throw new Error("APIFY_TOKEN_2 must be set in .env.local");

  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ACTOR_INPUT, from: screenName }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/**
 * Keep only KEEP_YEAR posts.
 *
 * posted_at is the ISO string toPostRow already parsed from the actor's
 * "Tue Sep 15 10:51:13 +0000 2026", so the year is read off the UTC date
 * rather than re-parsed - and rather than sliced off the string, which would
 * be right only by luck of the format.
 */
function keepYear(rows: PostRow[], year: number) {
  const kept: PostRow[] = [];
  let dropped = 0;

  for (const row of rows) {
    if (new Date(row.posted_at).getUTCFullYear() === year) kept.push(row);
    else dropped += 1;
  }
  return { kept, dropped };
}

/** GET /api/network/backfill?owner=... - the work queue. No actor runs, no charges. */
export async function GET(request: Request) {
  try {
    const ownerId =
      new URL(request.url).searchParams.get("owner") ?? DEFAULT_OWNER;

    const pending = await loadQueue(ownerId);

    return Response.json({
      ownerId,
      total: pending.length,
      remaining: pending.length,
      maxItems: MAX_ITEMS,
      keepYear: KEEP_YEAR,
      followerCeiling: FOLLOWER_CEILING,
      tweetFloor: TWEET_FLOOR,
      pending,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/network/backfill { screenName, restId? }
 *
 * One handle: one billable actor run, the year gate, then an upsert on
 * tweet_id. The browser drives the loop, so the tab can be closed between any
 * two handles without losing work.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let screenName = "";

  try {
    const body = await request.json().catch(() => ({}));
    screenName = String(body?.screenName ?? "").trim();
    const restId = body?.restId ? String(body.restId) : null;

    if (!screenName) {
      return Response.json({ error: "screenName is required" }, { status: 400 });
    }

    const tweets = await runActor(screenName);
    const { rows, skipped, duplicates } = toPostRows(tweets);
    const { kept, dropped } = keepYear(rows, KEEP_YEAR);

    if (kept.length > 0) {
      const db = supabaseAdmin();
      const { error } = await db
        .from("user_posts")
        .upsert(kept, { onConflict: "tweet_id" });
      if (error) throw new Error(`writing user_posts: ${error.message}`);
    }

    // The newest post the actor saw, kept or not: an account whose whole
    // timeline was dropped is worth telling apart from one that returned
    // nothing at all, and this says which year it went quiet in.
    const newest = rows.reduce<string | null>(
      (max, r) => (max === null || r.posted_at > max ? r.posted_at : max),
      null
    );

    return Response.json({
      screenName,
      restId,
      returned: tweets.length,
      imported: kept.length,
      droppedByYear: dropped,
      keepYear: KEEP_YEAR,
      newestPostAt: newest,
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
