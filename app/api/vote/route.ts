import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Vote = "like" | "dislike" | null;

/**
 * POST /api/vote  { userId, vote }
 *
 * vote: "like" | "dislike" | null (null clears the vote).
 * Goes through the server so the service-role key does the write — user_votes
 * has RLS enabled with no policies, so the browser cannot write to it directly.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId ?? "");
    const vote = body?.vote as Vote;

    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }
    if (vote !== "like" && vote !== "dislike" && vote !== null) {
      return Response.json(
        { error: 'vote must be "like", "dislike", or null' },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();

    // Clearing a vote removes the row rather than storing false/false.
    if (vote === null) {
      const { error } = await db.from("user_votes").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);
      return Response.json({ userId, vote: null });
    }

    const { error } = await db.from("user_votes").upsert(
      {
        user_id: userId,
        liked: vote === "like",
        disliked: vote === "dislike",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) throw new Error(error.message);
    return Response.json({ userId, vote });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
