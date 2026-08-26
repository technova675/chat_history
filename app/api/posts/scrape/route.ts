import { supabaseAdmin } from "@/lib/supabase";
import { toPostRows, type ApifyTweet } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 1000;

const ACTOR = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest";

/** Whose archive the handle list is drawn from. */
const DEFAULT_OWNER = "958230722292064256";

/** Actor input. Only twitterContent changes per handle. */
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
  since_time: "1769817600",
  until_time: "1787769000",
  min_retweets: 0,
  min_faves: 0,
  min_replies: 0,
  "-min_retweets": 0,
  "-min_faves": 0,
  "-min_replies": 0,
} as const;

/** Page past PostgREST's 1000-row ceiling, collecting one column into a Set. */
async function collect(
  table: string,
  column: string,
  apply: (q: any) => any = (q) => q // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<Set<string>> {
  const db = supabaseAdmin();
  const out = new Set<string>();
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await apply(
      db.from(table).select(column).range(from, from + page - 1)
    );
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    for (const row of data ?? []) {
      const value = (row as Record<string, unknown>)[column];
      if (value) out.add(String(value));
    }
    if (!data || data.length < page) break;
  }
  return out;
}

/**
 * The handles worth scraping: profiles that actually held a conversation in
 * this owner's archive. Same three-way intersection /users renders, ordered
 * by followers so the most valuable accounts are fetched first.
 */
async function loadHandles(ownerId: string): Promise<string[]> {
  const db = supabaseAdmin();

  const [senders, counterparties] = await Promise.all([
    collect("dm_messages", "sender_id", (q) => q.gt("seq", 0)),
    collect("dm_threads", "counterparty_id", (q) => q.eq("owner_id", ownerId)),
  ]);

  const handles: string[] = [];
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("user_info")
      .select("rest_id,screen_name")
      .not("screen_name", "is", null)
      .order("followers", { ascending: false, nullsFirst: false })
      .range(from, from + page - 1);

    if (error) throw new Error(`reading user_info: ${error.message}`);
    for (const row of data ?? []) {
      const id = String(row.rest_id);
      if (senders.has(id) && counterparties.has(id)) {
        handles.push(row.screen_name as string);
      }
    }
    if (!data || data.length < page) break;
  }
  return handles;
}

/** Handles that already have rows, lowercased - X handles are case-insensitive. */
async function loadScraped(): Promise<Set<string>> {
  const names = await collect("user_posts", "author_username");
  return new Set([...names].map((n) => n.toLowerCase()));
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

/** GET /api/posts/scrape - the work queue. No actor runs, no charges. */
export async function GET(request: Request) {
  try {
    const ownerId =
      new URL(request.url).searchParams.get("owner") ?? DEFAULT_OWNER;

    const [handles, scraped] = await Promise.all([
      loadHandles(ownerId),
      loadScraped(),
    ]);
    const pending = handles.filter((h) => !scraped.has(h.toLowerCase()));

    return Response.json({
      ownerId,
      total: handles.length,
      done: handles.length - pending.length,
      remaining: pending.length,
      maxItems: ACTOR_INPUT.maxItems,
      pending,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/posts/scrape { screenName }
 *
 * One handle: run the actor, upsert what comes back, return the counts. The
 * browser drives the loop, so each call is a single billable actor run and
 * the tab can be closed between any two of them without losing work.
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
