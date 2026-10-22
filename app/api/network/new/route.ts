import { supabaseAdmin } from "@/lib/supabase";
import { toPostRows, type ApifyTweet } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 250;

/**
 * The new-followers sweep: the accounts that started following an owner in
 * one import window, fetched with the actor input set on /network/new.
 *
 * The queue is exactly
 *
 *   select rest_id, screen_name
 *     from public.followers
 *    where owner_id = $owner
 *      and fetched_at >= $since      -- default 2026-10-21 00:00 UTC
 *      and fetched_at <  $until;     -- default 2026-10-22 00:00 UTC
 *
 * Followers only: `following` is not part of it. load_follow_graph.py
 * --only-new stamps the rows it adds with the run's time, so the window picks
 * out that import's additions. ?since= and ?until= move it.
 *
 * Progress is read back from user_posts_summary on every GET rather than kept
 * in the browser, so a reload - or a second tab - shows the same numbers.
 */

/** Whose graph the queue is drawn from. Overridable with ?owner=. */
const DEFAULT_OWNER = "958230722292064256";

/** The import window, [since, until). Overridable with ?since= / ?until=. */
const DEFAULT_SINCE = "2026-10-21T00:00:00+00:00";
const DEFAULT_UNTIL = "2026-10-22T00:00:00+00:00";

/** Used when the request names no actor. Same one the other sweeps run. */
const DEFAULT_ACTOR =
  "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest";

/** PostgREST caps a response at 1,000 rows, so a full table is read in pages. */
const FETCH_PAGE = 1000;

/** How many ids one `.in(...)` filter carries. Keeps the URL under its limit. */
const IN_CHUNK = 200;

type Edge = {
  rest_id: string;
  screen_name: string | null;
  followers: number | null;
  tweets: number | null;
};

/** The followers imported in [since, until), paged. */
async function loadEdges(
  ownerId: string,
  since: string,
  until: string
): Promise<Edge[]> {
  const db = supabaseAdmin();
  const rows: Edge[] = [];

  for (let offset = 0; ; offset += FETCH_PAGE) {
    const { data, error } = await db
      .from("followers")
      .select("rest_id,screen_name,followers,tweets")
      .eq("owner_id", ownerId)
      .gte("fetched_at", since)
      .lt("fetched_at", until)
      .order("rest_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(`reading followers: ${error.message}`);
    const page = (data ?? []) as unknown as Edge[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

/** Stored post count per author, for the ids that have any. */
async function loadPostCounts(
  ids: string[]
): Promise<Map<string, { posts: number; last_fetched_at: string | null }>> {
  const db = supabaseAdmin();
  const out = new Map<string, { posts: number; last_fetched_at: string | null }>();

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("user_posts_summary")
      .select("author_id,posts,last_fetched_at")
      .in("author_id", ids.slice(i, i + IN_CHUNK));

    if (error) throw new Error(`reading user_posts_summary: ${error.message}`);
    for (const row of data ?? []) {
      out.set(String(row.author_id), {
        posts: Number(row.posts ?? 0),
        last_fetched_at: row.last_fetched_at ?? null,
      });
    }
  }
  return out;
}

export type NewAccount = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
  tweets: number | null;
  posts: number;
  last_fetched_at: string | null;
};

/**
 * Every account in the window with its post count, most active first. Done
 * and pending are both returned: the page draws the whole list, not just the
 * remainder, so finished accounts stay visible as progress.
 */
async function loadBatch(
  ownerId: string,
  since: string,
  until: string
): Promise<NewAccount[]> {
  // No handle means nothing to put in `from:`, and /network drops them anyway.
  const edges = (await loadEdges(ownerId, since, until)).filter((e) => e.screen_name);
  const counts = await loadPostCounts(edges.map((e) => e.rest_id));

  return edges
    .map((e) => {
      const c = counts.get(e.rest_id);
      return {
        rest_id: e.rest_id,
        screen_name: e.screen_name as string,
        followers: e.followers,
        tweets: e.tweets,
        posts: c?.posts ?? 0,
        last_fetched_at: c?.last_fetched_at ?? null,
      };
    })
    .sort(
      (a, b) =>
        (b.tweets ?? -1) - (a.tweets ?? -1) || (a.rest_id < b.rest_id ? -1 : 1)
    );
}

/**
 * The pasted actor input with this handle filled in. Every "{handle}" in a
 * string value becomes the screen name and "{now}" the current unix time. A
 * query without "{handle}" gets `from: <handle>` added, so a run can never
 * fetch the same results for every account.
 */
function buildInput(query: Record<string, unknown>, screenName: string) {
  const now = String(Math.floor(Date.now() / 1000));
  const text = JSON.stringify(query);
  const filled = JSON.parse(
    text.replaceAll("{handle}", screenName).replaceAll("{now}", now)
  );
  return text.includes("{handle}") ? filled : { ...filled, from: screenName };
}

/** One synchronous actor run for one handle. */
async function runActor(
  actor: string,
  account: "1" | "2",
  input: Record<string, unknown>
): Promise<ApifyTweet[]> {
  // The page picks the Apify account, so this sweep can run alongside the
  // others without sharing one account's concurrent-run cap.
  const envName = account === "2" ? "APIFY_TOKEN_2" : "APIFY_TOKEN";
  const token = process.env[envName];
  if (!token) throw new Error(`${envName} must be set in .env.local`);

  const res = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/** GET /api/network/new?owner=&since=&until= - the queue and its progress. No charges. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const ownerId = params.get("owner") ?? DEFAULT_OWNER;
    const since = params.get("since") || DEFAULT_SINCE;
    const until = params.get("until") || DEFAULT_UNTIL;

    const accounts = await loadBatch(ownerId, since, until);

    return Response.json({
      ownerId,
      since,
      until,
      defaultActor: DEFAULT_ACTOR,
      accounts,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/network/new { screenName, restId?, query, actor?, account? }
 *
 * One handle: one billable actor run with the pasted query, upserted on
 * tweet_id so a re-run refreshes posts rather than duplicating them.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let screenName = "";

  try {
    const body = await request.json().catch(() => ({}));
    screenName = String(body?.screenName ?? "").trim();
    const restId = body?.restId ? String(body.restId) : null;
    const actor = String(body?.actor ?? "").trim() || DEFAULT_ACTOR;
    const account = body?.account === "2" ? "2" : "1";
    const query = body?.query;

    if (!screenName) {
      return Response.json({ error: "screenName is required" }, { status: 400 });
    }
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      return Response.json(
        { error: "query must be a JSON object (the actor input)" },
        { status: 400 }
      );
    }

    const tweets = await runActor(actor, account, buildInput(query, screenName));
    const { rows, skipped, duplicates } = toPostRows(tweets);

    // A query can return other people's posts (a search, a reply thread).
    // Count them, but store them all - user_posts is keyed by tweet, and each
    // row carries its own author_id.
    const own = restId ? rows.filter((r) => String(r.author_id) === restId).length : null;

    if (rows.length > 0) {
      const db = supabaseAdmin();
      const { error } = await db
        .from("user_posts")
        .upsert(rows, { onConflict: "tweet_id" });
      if (error) throw new Error(`writing user_posts: ${error.message}`);
    }

    return Response.json({
      screenName,
      restId,
      returned: tweets.length,
      imported: rows.length,
      own,
      skipped,
      duplicates,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return Response.json(
      { screenName, error: (err as Error).message, elapsedMs: Date.now() - started },
      { status: 500 }
    );
  }
}
