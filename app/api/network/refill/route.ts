import { supabaseAdmin } from "@/lib/supabase";
import { toPostRows, type ApifyTweet } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 250;

const ACTOR = "apidojo~twitter-scraper-lite";

/**
 * The re-fill sweep: every account that already has posts stored, re-fetched
 * for its latest original posts.
 *
 * Deliberately a separate route rather than a flag on /api/network/scrape:
 * that one's queue is "accounts with no posts at all", this one's is "accounts
 * with posts", and the two want different actor inputs.
 */

/** Whose graph the queue is drawn from. Overridable with ?owner=. */
const DEFAULT_OWNER = "958230722292064256";

/** Posts requested per handle. */
const MAX_ITEMS = 40;

/** Only posts from this calendar year (UTC) are written. */
const KEEP_YEAR = 2026;

/**
 * Actor input, less the search term, which is set per handle. No date window
 * or lang. The query excludes replies but not retweets: adding
 * -filter:nativeretweets makes this actor return nothing.
 */
const ACTOR_INPUT = {
  includeSearchTerms: false,
  maxItems: MAX_ITEMS,
  sort: "Latest",
} as const;

/** PostgREST caps a response at 1,000 rows, so a full table is read in pages. */
const FETCH_PAGE = 1000;

/** How many ids one `.in(...)` filter carries. Keeps the URL under its limit. */
const IN_CHUNK = 200;

type Edge = {
  rest_id: string;
  screen_name: string | null;
  followers: number | null;
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
      .select("rest_id,screen_name,followers,protected,fetched_at")
      .eq("owner_id", ownerId)
      .order("rest_id", { ascending: true })
      .range(offset, offset + FETCH_PAGE - 1);

    if (error) throw new Error(`reading ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Edge[];
    rows.push(...page);
    if (page.length < FETCH_PAGE) return rows;
  }
}

type Rollup = {
  posts: number | null;
  median_views: number | null;
  total_views: number | null;
};

/** The post rollup for a set of ids, read in chunks. */
async function loadRollups(ids: string[]): Promise<Map<string, Rollup>> {
  const db = supabaseAdmin();
  const out = new Map<string, Rollup>();

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("user_posts_summary")
      .select("author_id,posts,median_views,total_views")
      .in("author_id", ids.slice(i, i + IN_CHUNK));

    if (error) throw new Error(`reading user_posts_summary: ${error.message}`);
    for (const row of data ?? []) {
      out.set(String(row.author_id), {
        posts: row.posts,
        median_views: row.median_views,
        total_views: row.total_views,
      });
    }
  }
  return out;
}

export type Candidate = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
  posts: number;
  median_views: number | null;
};

/**
 * The queue. Stands in for the hand-written SQL this sweep was specified by:
 *
 *   with edges as (
 *     select ... from followers  where owner_id = $1
 *     union all
 *     select ... from following  where owner_id = $1
 *   ),
 *   accounts as (
 *     select rest_id,
 *            (array_agg(screen_name order by fetched_at desc))[1] as screen_name,
 *            (array_agg(followers   order by fetched_at desc))[1] as followers
 *       from edges group by rest_id
 *   )
 *   select a.*, s.posts, s.median_views
 *     from accounts a
 *     join user_posts_summary s on s.author_id = a.rest_id
 *    where a.screen_name is not null
 *    order by s.posts, s.median_views desc nulls last, a.rest_id;
 *
 * The join is an inner one on purpose: `s.posts is not null` is the point of
 * this sweep. An account with no rollup row was never scraped at all, and
 * belongs to /network/scrape, not here.
 *
 * PostgREST cannot express the union or the per-owner fold, so both directions
 * are read and merged here. Freshest edge wins for the profile fields, the
 * same way the /network cards resolve a mutual's two rows.
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

  // No handle means nothing to search for.
  const eligible = [...byId.values()].filter((e) => e.screen_name);

  const rollups = await loadRollups(eligible.map((e) => e.rest_id));

  const out: Candidate[] = [];
  for (const e of eligible) {
    const r = rollups.get(e.rest_id);
    if (!r || r.posts === null) continue; // never scraped - not this sweep's job
    out.push({
      rest_id: e.rest_id,
      screen_name: e.screen_name as string,
      followers: e.followers,
      posts: r.posts,
      median_views: r.median_views,
    });
  }

  // posts asc, then median_views desc nulls last, rest_id asc - the accounts
  // with the fewest posts stored are fetched first.
  return out.sort(
    (a, b) =>
      a.posts - b.posts ||
      (b.median_views ?? -1) - (a.median_views ?? -1) ||
      (a.rest_id < b.rest_id ? -1 : 1)
  );
}

/** How many posts this handle has stored right now. */
async function storedPosts(restId: string): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("user_posts")
    .select("tweet_id", { count: "exact", head: true })
    .eq("author_id", restId);

  if (error) throw new Error(`reading user_posts: ${error.message}`);
  return count ?? 0;
}

/** One synchronous actor run for one handle. */
async function runActor(screenName: string): Promise<ApifyTweet[]> {
  // This sweep runs on the SECOND Apify account only. No fallback to
  // APIFY_TOKEN: silently borrowing it would put two sweeps on one account's
  // concurrent-run cap.
  const token = process.env.APIFY_TOKEN_2;
  if (!token) throw new Error("APIFY_TOKEN_2 must be set in .env.local");

  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ACTOR_INPUT,
        searchTerms: [`from:${screenName} -filter:replies`],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/**
 * Refresh this handle's profile counts in the follow graph from the `author`
 * object the actor returns on every tweet. Only an author that IS this handle
 * counts - matched on rest_id when known, else on the handle - so another
 * account's numbers can never land on this row.
 *
 * Every owner's row for the account is updated: the profile is the same
 * whoever's graph it sits in. fetched_at is left alone - /network/new reads it
 * as the import date. Returns the number of rows updated across both tables.
 */
async function updateProfile(
  tweets: ApifyTweet[],
  screenName: string,
  restId: string | null
): Promise<number> {
  const author = tweets
    .map((t) => t?.author)
    .find((a) =>
      restId
        ? String(a?.id ?? "") === restId
        : String(a?.userName ?? "").toLowerCase() === screenName.toLowerCase()
    );
  if (!author?.id) return 0;

  // A field the actor left out keeps its stored value rather than going null.
  const patch: Record<string, string | number> = {};
  if (typeof author.statusesCount === "number") patch.tweets = author.statusesCount;
  if (typeof author.followers === "number") patch.followers = author.followers;
  if (typeof author.following === "number") patch.following = author.following;
  if (typeof author.profilePicture === "string" && author.profilePicture) {
    patch.avatar_url = author.profilePicture;
  }
  // An empty bio is never written: some actors (kaitoeasyapi) send "" here and
  // keep the real one in profile_bio, and "" would wipe a stored bio.
  const bio = author.description || author.profile_bio?.description;
  if (typeof bio === "string" && bio) patch.description = bio;
  if (Object.keys(patch).length === 0) return 0;

  const db = supabaseAdmin();
  let updated = 0;
  for (const table of ["followers", "following"] as const) {
    const { count, error } = await db
      .from(table)
      .update(patch, { count: "exact" })
      .eq("rest_id", String(author.id));
    if (error) throw new Error(`updating ${table}: ${error.message}`);
    updated += count ?? 0;
  }
  return updated;
}

/** GET /api/network/refill?owner=... - the work queue. No actor runs, no charges. */
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
      pending,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/network/refill { screenName, restId? }
 *
 * One handle: one billable actor run, upserted on tweet_id so the posts
 * already stored are refreshed rather than duplicated. The browser drives the
 * loop, so the tab can be closed between any two handles without losing work.
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

    const before = restId ? await storedPosts(restId) : null;

    const tweets = await runActor(screenName);
    const mapped = toPostRows(tweets);
    const { skipped, duplicates } = mapped;

    // The search already excludes replies; this is the guarantee. Retweets are
    // dropped here rather than in the query (-filter:nativeretweets makes this
    // actor return nothing), and so are posts from any other year, so only
    // KEEP_YEAR originals reach the table. All of them are still billed -
    // Apify charges per result, before this filter.
    const isRetweet = (r: (typeof mapped.rows)[number]) => Boolean(r.raw?.isRetweet);
    const replies = mapped.rows.filter((r) => r.is_reply).length;
    const retweets = mapped.rows.filter((r) => !r.is_reply && isRetweet(r)).length;
    const original = mapped.rows.filter((r) => !r.is_reply && !isRetweet(r));
    const otherYear = original.filter(
      (r) => new Date(r.posted_at).getUTCFullYear() !== KEEP_YEAR
    ).length;
    const rows = original.filter(
      (r) => new Date(r.posted_at).getUTCFullYear() === KEEP_YEAR
    );

    if (rows.length > 0) {
      const db = supabaseAdmin();
      const { error } = await db
        .from("user_posts")
        .upsert(rows, { onConflict: "tweet_id" });
      if (error) throw new Error(`writing user_posts: ${error.message}`);
    }

    // From every tweet returned, dropped ones included: the author object is
    // the profile as of this run whether or not the post itself is kept.
    const profileRows = await updateProfile(tweets, screenName, restId);

    // What the run actually bought: rows already stored are refreshed, not
    // added, so `imported` on its own overstates the gain.
    const after = restId ? await storedPosts(restId) : null;

    return Response.json({
      screenName,
      restId,
      returned: tweets.length,
      imported: rows.length,
      skipped,
      duplicates,
      replies,
      retweets,
      otherYear,
      profileRows,
      postsBefore: before,
      postsAfter: after,
      gained: before !== null && after !== null ? after - before : null,
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
