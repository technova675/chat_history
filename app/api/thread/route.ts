import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/thread?userId=<rest_id>
 *
 * Returns the DM conversation with that account: the thread summary from
 * dm_threads plus every message in chronological order.
 */
export async function GET(request: Request) {
  try {
    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }

    const db = supabaseAdmin();

    const { data: thread, error: threadError } = await db
      .from("dm_threads")
      .select(
        "conversation_id,counterparty_id,initiated_by_me,inbound_count,outbound_count,message_count,reply_bucket,first_message_at,last_message_at,span_days"
      )
      .eq("counterparty_id", userId)
      .maybeSingle();

    if (threadError) throw new Error(threadError.message);

    // Ids come from dm_messages, but only threads that got a reply were loaded
    // into dm_threads — so a profile can legitimately have no thread here.
    if (!thread) {
      return Response.json({ thread: null, messages: [] });
    }

    const { data: messages, error: messagesError } = await db
      .from("dm_messages")
      .select("message_id,is_from_me,body,created_at,seq")
      .eq("conversation_id", thread.conversation_id)
      .order("seq", { ascending: true });

    if (messagesError) throw new Error(messagesError.message);

    return Response.json({ thread, messages: messages ?? [] });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
