import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTOR = "kaitoeasyapi~premium-twitter-user-scraper-pay-per-result";
const BATCH_SIZE = 25;

type ApifyUser = Record<string, any>;

/** Read the id list produced from Supabase (user.json is [{ user_id }, ...]). */
async function loadUserIds(): Promise<string[]> {
  const file = path.join(process.cwd(), "user.json");
  const rows = JSON.parse(await readFile(file, "utf8")) as { user_id: string }[];
  return [...new Set(rows.map((r) => String(r.user_id)).filter(Boolean))];
}

/** Ids already in user_info, in either terminal state. Paged past PostgREST's 1000-row cap. */
async function loadFetchedIds(): Promise<Set<string>> {
  const db = supabaseAdmin();
  const done = new Set<string>();
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("user_info")
      .select("rest_id")
      .range(from, from + page - 1);

    if (error) throw new Error(`reading user_info: ${error.message}`);
    for (const row of data ?? []) done.add(row.rest_id as string);
    if (!data || data.length < page) break;
  }
  return done;
}

/** "Sun Jun 12 15:57:35 +0000 2022" -> ISO, or null if unparseable. */
function parseTwitterDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Flatten the actor's nested profile into our column layout. */
function toRow(user: ApifyUser) {
  return {
    rest_id: String(user.rest_id),
    screen_name: user.core?.screen_name ?? null,
    name: user.core?.name ?? null,
    description: user.profile_bio?.description ?? null,
    location: user.location?.location ?? null,
    website: user.website?.url || null,
    account_created_at: parseTwitterDate(user.core?.created_at),
    followers: user.relationship_counts?.followers ?? null,
    following: user.relationship_counts?.following ?? null,
    tweets: user.tweet_counts?.tweets ?? null,
    media_tweets: user.tweet_counts?.media_tweets ?? null,
    favorites_count: user.action_counts?.favorites_count ?? null,
    creator_subscriptions_count: user.creator_subscriptions_count ?? null,
    is_blue_verified: user.verification?.is_blue_verified ?? null,
    verified: user.verification?.verified ?? null,
    protected: user.privacy?.protected ?? null,
    suspended: user.privacy?.suspended ?? null,
    can_dm: user.dm_permissions?.can_dm ?? null,
    avatar_url: user.avatar?.image_url ?? null,
    banner_url: user.banner?.image_url ?? null,
    fetch_status: "ok" as const,
    raw: user,
    fetched_at: new Date().toISOString(),
  };
}

/** Run the actor synchronously and return its dataset items. */
async function runActor(ids: string[]): Promise<ApifyUser[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be set in .env.local");

  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_ids: ids }),
    }
  );

  if (!res.ok) {
    throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

/** GET /api/scrape - progress only, no charges. */
export async function GET() {
  try {
    const ids = await loadUserIds();
    const done = await loadFetchedIds();
    const db = supabaseAdmin();

    const { data } = await db.from("user_info_progress").select("*").single();

    return Response.json({
      total: ids.length,
      fetched: done.size,
      remaining: ids.length - done.size,
      ok: data?.ok ?? 0,
      notFound: data?.not_found ?? 0,
      batchSize: BATCH_SIZE,
      batchesRemaining: Math.ceil((ids.length - done.size) / BATCH_SIZE),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/scrape - fetch exactly one batch of ids not yet in user_info.
 * Charges Apify ~$0.00015 per profile returned. Idempotent: already-fetched
 * ids are skipped, so this is safe to call repeatedly and safe to resume.
 */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const size = Math.min(Math.max(Number(body?.size) || BATCH_SIZE, 1), 100);

    const allIds = await loadUserIds();
    const done = await loadFetchedIds();
    const pending = allIds.filter((id) => !done.has(id));

    if (pending.length === 0) {
      return Response.json({
        done: true,
        requested: 0,
        ok: 0,
        notFound: 0,
        remaining: 0,
        message: "All ids fetched.",
      });
    }

    const batch = pending.slice(0, size);
    const users = await runActor(batch);

    // Rows the actor actually returned.
    const rows = users
      .filter((u) => u && u.rest_id)
      .map(toRow);

    // Ids we asked for but got nothing back for: deleted, suspended, invalid.
    const returned = new Set(rows.map((r) => r.rest_id));
    const missing = batch
      .filter((id) => !returned.has(id))
      .map((id) => ({
        rest_id: id,
        fetch_status: "not_found" as const,
        raw: null,
        fetched_at: new Date().toISOString(),
      }));

    const db = supabaseAdmin();
    const payload = [...rows, ...missing];

    if (payload.length > 0) {
      const { error } = await db
        .from("user_info")
        .upsert(payload, { onConflict: "rest_id" });
      if (error) throw new Error(`writing user_info: ${error.message}`);
    }

    return Response.json({
      done: false,
      requested: batch.length,
      ok: rows.length,
      notFound: missing.length,
      remaining: pending.length - batch.length,
      elapsedMs: Date.now() - started,
      sample: rows.slice(0, 3).map((r) => ({
        rest_id: r.rest_id,
        screen_name: r.screen_name,
        followers: r.followers,
      })),
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message, elapsedMs: Date.now() - started },
      { status: 500 }
    );
  }
}
