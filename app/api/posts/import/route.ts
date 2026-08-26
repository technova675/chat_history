import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase";
import { toPostRows, type ApifyTweet } from "@/lib/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Upsert chunk size. PostgREST chokes on very large bodies; raw jsonb is fat. */
const CHUNK = 200;

/** Read an actor dump from the project root. */
async function loadFile(file: string): Promise<ApifyTweet[]> {
  // Basename only: this reads from the server's filesystem, so never let a
  // request walk out of the project directory.
  const safe = path.basename(file);
  const items = JSON.parse(
    await readFile(path.join(process.cwd(), safe), "utf8")
  );
  if (!Array.isArray(items)) {
    throw new Error(`${safe} must contain a JSON array of tweets`);
  }
  return items as ApifyTweet[];
}

/**
 * POST /api/posts/import
 *
 * Body is either { file: "posts.json" } to read a dataset dump from the
 * project root, or { posts: [...] } to pass the array inline.
 *
 * Idempotent: upserts on tweet_id, so re-running refreshes the engagement
 * counts on tweets already stored rather than duplicating them.
 */
export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({}));

    const tweets: ApifyTweet[] = Array.isArray(body?.posts)
      ? body.posts
      : await loadFile(String(body?.file ?? "posts.json"));

    const { rows, skipped, duplicates } = toPostRows(tweets);

    if (rows.length === 0) {
      return Response.json({
        imported: 0,
        skipped,
        duplicates,
        message: "Nothing usable in the payload.",
      });
    }

    const db = supabaseAdmin();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from("user_posts")
        .upsert(rows.slice(i, i + CHUNK), { onConflict: "tweet_id" });
      if (error) throw new Error(`writing user_posts: ${error.message}`);
    }

    const authors = [...new Set(rows.map((r) => r.author_id))];

    return Response.json({
      imported: rows.length,
      skipped,
      duplicates,
      authors: authors.length,
      authorIds: authors.slice(0, 20),
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message, elapsedMs: Date.now() - started },
      { status: 500 }
    );
  }
}
