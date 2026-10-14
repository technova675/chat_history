import { supabaseAdmin } from "@/lib/supabase";
import { parseActor } from "@/lib/actors";
import { loadChoices } from "@/lib/choices";

export const dynamic = "force-dynamic";

type Vote = "like" | "dislike" | null;

/**
 * POST /api/vote  { userId, ownerId, vote, takeOver? }
 *
 * vote: "like" | "dislike" | null (null clears the vote).
 * Goes through the server so the service-role key does the write — user_votes
 * has RLS enabled with no policies, so the browser cannot write to it directly.
 *
 * The vote is cast as ownerId. Like and Dislike each belong to one owner at a
 * time: if the other owner already holds the one asked for, this answers 409
 * with heldBy, and the card asks before sending it again with takeOver, which
 * clears the other owner's vote. Answers with every owner's choices on the
 * account, so the card shows the result without a page load.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId ?? "");
    const vote = body?.vote as Vote;
    const takeOver = body?.takeOver === true;
    // Vir or Sim: the owner selected in the dropdown, or picked in the popup.
    const ownerId = parseActor(body?.ownerId);

    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }
    if (!ownerId) {
      return Response.json(
        { error: "ownerId must be one of the two owners" },
        { status: 400 }
      );
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
      const { error } = await db
        .from("user_votes")
        .delete()
        .eq("user_id", userId)
        .eq("owner_id", ownerId);
      if (error) throw new Error(error.message);
      return Response.json({ userId, ownerId, vote: null, choices: await loadChoices(userId) });
    }

    // Who else holds this vote. Rows from before votes were per owner have no
    // owner_id and hold nothing.
    const { data: holders, error: holdersError } = await db
      .from("user_votes")
      .select("owner_id")
      .eq("user_id", userId)
      .eq(vote === "like" ? "liked" : "disliked", true)
      .neq("owner_id", ownerId);
    if (holdersError) throw new Error(holdersError.message);

    if (holders.length > 0) {
      if (!takeOver) {
        return Response.json(
          { error: "held by another owner", heldBy: holders[0].owner_id },
          { status: 409 }
        );
      }
      // Moving it: the other owner's vote is cleared, the same as their
      // clicking it off.
      const { error } = await db
        .from("user_votes")
        .delete()
        .eq("user_id", userId)
        .in("owner_id", holders.map((h) => h.owner_id));
      if (error) throw new Error(error.message);
    }

    const { error } = await db.from("user_votes").upsert(
      {
        user_id: userId,
        owner_id: ownerId,
        liked: vote === "like",
        disliked: vote === "dislike",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,owner_id" }
    );

    if (error) throw new Error(error.message);
    return Response.json({ userId, ownerId, vote, choices: await loadChoices(userId) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
