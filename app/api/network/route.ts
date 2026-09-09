import { loadSocialCards, parseRelation, parseSort } from "@/lib/socialCards";

export const dynamic = "force-dynamic";

/**
 * GET /api/network?offset=&limit=&owner=&rel=&sort=
 *
 * Pages the follower/following feed. The first page is server-rendered by
 * /network; this serves every page after it as the grid scrolls.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 100);
    const owner = params.get("owner");
    const relation = parseRelation(params.get("rel"));
    const sort = parseSort(params.get("sort"));

    const users = await loadSocialCards(owner || null, relation, offset, limit, sort);

    return Response.json({ users, offset, limit });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
