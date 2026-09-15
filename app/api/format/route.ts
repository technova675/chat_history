import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Format = "heygen" | "text_format";

/**
 * POST /api/format  { userId, format, value }
 *
 * format: "heygen" | "text_format", value: boolean. The two are independent -
 * setting one never clears the other - so this toggles a single column and
 * leaves the row's other flag alone.
 *
 * Goes through the server so the service-role key does the write: user_formats
 * has RLS enabled with no policies, like user_votes.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId ?? "");
    const format = body?.format as Format;
    const value = body?.value;

    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }
    if (format !== "heygen" && format !== "text_format") {
      return Response.json(
        { error: 'format must be "heygen" or "text_format"' },
        { status: 400 }
      );
    }
    if (typeof value !== "boolean") {
      return Response.json({ error: "value must be a boolean" }, { status: 400 });
    }

    const db = supabaseAdmin();

    // Upsert rather than update: the row only exists once a format has been
    // picked, and the column left out keeps its default false on insert.
    const { error } = await db.from("user_formats").upsert(
      {
        user_id: userId,
        [format]: value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) throw new Error(error.message);
    return Response.json({ userId, format, value });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
