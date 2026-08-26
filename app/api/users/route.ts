import { loadCards, type VoteFilter } from "@/lib/userCards";

export const dynamic = "force-dynamic";

/**
 * GET /api/users?offset=&limit=&owner=&vote=
 *
 * Pages the card feed. The first page is server-rendered by /users; this
 * serves every page after it as the grid scrolls.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 100);
    const owner = params.get("owner");
    const voteParam = params.get("vote");
    const vote: VoteFilter =
      voteParam === "like" || voteParam === "dislike" || voteParam === "none"
        ? voteParam
        : null;

    const users = await loadCards(owner || null, vote, offset, limit);

    return Response.json({ users, offset, limit });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
