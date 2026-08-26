import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const COLUMNS =
  "tweet_id,author_id,author_username,text,lang,url,posted_at," +
  "reply_count,retweet_count,quote_count,like_count,bookmark_count,view_count," +
  "is_reply,is_pinned,media_count,media_types";

const SORTS = {
  recent: { column: "posted_at", ascending: false },
  likes: { column: "like_count", ascending: false },
  views: { column: "view_count", ascending: false },
} as const;

type Sort = keyof typeof SORTS;

/**
 * GET /api/posts?userId=<rest_id>&sort=recent|likes|views&limit=&offset=
 *
 * That account's scraped tweets, newest first by default, plus the
 * user_posts_summary rollup so a card can show totals without a second call.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const userId = params.get("userId");
    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }

    const sortKey = (params.get("sort") ?? "recent") as Sort;
    const sort = SORTS[sortKey];
    if (!sort) {
      return Response.json(
        { error: `sort must be one of: ${Object.keys(SORTS).join(", ")}` },
        { status: 400 }
      );
    }

    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 100);
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const withReplies = params.get("replies") === "1";

    const db = supabaseAdmin();

    let query = db
      .from("user_posts")
      .select(COLUMNS, { count: "exact" })
      .eq("author_id", userId);

    // Replies are noise on a profile card, so they are opt-in.
    if (!withReplies) query = query.eq("is_reply", false);

    const { data, error, count } = await query
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    const { data: summary, error: summaryError } = await db
      .from("user_posts_summary")
      .select("*")
      .eq("author_id", userId)
      .maybeSingle();

    if (summaryError) throw new Error(summaryError.message);

    return Response.json({
      posts: data ?? [],
      summary: summary ?? null,
      total: count ?? 0,
      hasMore: offset + (data?.length ?? 0) < (count ?? 0),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
