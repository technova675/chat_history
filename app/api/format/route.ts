import { supabaseAdmin } from "@/lib/supabase";
import { parseActor } from "@/lib/actors";
import { loadChoices } from "@/lib/choices";

export const dynamic = "force-dynamic";

type Format = "heygen" | "text_format" | "personal";

/**
 * POST /api/format  { userId, ownerId, format, value }
 *
 * format: "heygen" | "text_format" | "personal", value: boolean. They are
 * independent - setting one never clears another - so this toggles a single
 * column and leaves the row's other flags alone.
 *
 * Goes through the server so the service-role key does the write: user_formats
 * has RLS enabled with no policies, like user_votes.
 *
 * The pick is made as ownerId. Each format belongs to one owner at a time: if
 * the other owner already holds the one being turned on, this answers 409
 * with heldBy, and the card asks before sending it again with takeOver, which
 * turns it off for the other owner. Answers with every owner's choices on the
 * account, so the card shows the result without a page load.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId ?? "");
    const format = body?.format as Format;
    const value = body?.value;
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
    if (
      format !== "heygen" &&
      format !== "text_format" &&
      format !== "personal"
    ) {
      return Response.json(
        { error: 'format must be "heygen", "text_format" or "personal"' },
        { status: 400 }
      );
    }
    if (typeof value !== "boolean") {
      return Response.json({ error: "value must be a boolean" }, { status: 400 });
    }

    const db = supabaseAdmin();

    if (value) {
      // Who else holds this format. Rows from before picks were per owner
      // have no owner_id and hold nothing.
      const { data: holders, error: holdersError } = await db
        .from("user_formats")
        .select("owner_id")
        .eq("user_id", userId)
        .eq(format, true)
        .neq("owner_id", ownerId);
      if (holdersError) throw new Error(holdersError.message);

      if (holders.length > 0) {
        if (!takeOver) {
          return Response.json(
            { error: "held by another owner", heldBy: holders[0].owner_id },
            { status: 409 }
          );
        }
        // Moving it: off for the other owner, their other formats untouched.
        const { error } = await db
          .from("user_formats")
          .update({ [format]: false, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .in("owner_id", holders.map((h) => h.owner_id));
        if (error) throw new Error(error.message);
      }
    }

    // Upsert rather than update: the row only exists once a format has been
    // picked, and the columns left out keep their default false on insert.
    const { error } = await db.from("user_formats").upsert(
      {
        user_id: userId,
        owner_id: ownerId,
        [format]: value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,owner_id" }
    );

    if (error) throw new Error(error.message);
    return Response.json({
      userId,
      ownerId,
      format,
      value,
      choices: await loadChoices(userId),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
