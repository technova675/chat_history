import { supabaseAdmin } from "@/lib/supabase";
import { NO_CHOICES, type OwnerChoices } from "@/lib/actors";

/**
 * Every owner's votes and format picks on one account, as the card holds
 * them. /api/vote and /api/format return this after a save, so the card can
 * show a takeover - the other owner losing the option - without a page load.
 *
 * Rows from before votes were per owner have no owner_id and count for nobody.
 */
export async function loadChoices(userId: string): Promise<OwnerChoices> {
  const db = supabaseAdmin();
  const [votes, formats] = await Promise.all([
    db
      .from("user_votes")
      .select("owner_id,liked,disliked")
      .eq("user_id", userId)
      .not("owner_id", "is", null),
    db
      .from("user_formats")
      .select("owner_id,heygen,text_format,personal")
      .eq("user_id", userId)
      .not("owner_id", "is", null),
  ]);
  if (votes.error) throw new Error(votes.error.message);
  if (formats.error) throw new Error(formats.error.message);

  const c: OwnerChoices = structuredClone(NO_CHOICES);
  for (const v of votes.data ?? []) {
    if (v.liked) c.liked_by.push(v.owner_id);
    if (v.disliked) c.disliked_by.push(v.owner_id);
  }
  for (const f of formats.data ?? []) {
    if (f.heygen) c.heygen_by.push(f.owner_id);
    if (f.text_format) c.text_by.push(f.owner_id);
    if (f.personal) c.personal_by.push(f.owner_id);
  }
  return c;
}
