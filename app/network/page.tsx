import { supabaseAdmin } from "@/lib/supabase";
import OwnerPicker, { type Owner } from "@/app/users/OwnerPicker";
import UsersFeed from "@/app/users/UsersFeed";
import { compact } from "@/lib/format";
import {
  loadSocialCards,
  loadSocialCounts,
  loadSocialTotals,
  parseRelation,
  PAGE_SIZE,
  type RelationFilter,
} from "@/lib/socialCards";

export const dynamic = "force-dynamic";

/** Archive owners, for the dropdown. Same list /users offers. */
async function loadOwners(): Promise<Owner[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("owners")
    .select("owner_id,screen_name,name,avatar_url,is_blue_verified")
    .order("screen_name");

  if (error) throw new Error(error.message);
  return (data ?? []) as Owner[];
}

/** Link-based direction pills. Preserves the owner selection. */
function RelationPills({
  ownerId,
  active,
  counts,
}: {
  ownerId: string | null;
  active: RelationFilter;
  counts: { all: number; follower: number; following: number; mutual: number };
}) {
  const href = (relation: RelationFilter) => {
    const params = new URLSearchParams();
    if (ownerId) params.set("owner", ownerId);
    if (relation) params.set("rel", relation);
    const qs = params.toString();
    return qs ? `/network?${qs}` : "/network";
  };

  const pills = [
    { key: null, label: "All", count: counts.all, on: "border-neutral-500 bg-neutral-800 text-white" },
    { key: "following" as const, label: "Following", count: counts.following, on: "border-sky-800 bg-sky-950/60 text-sky-400" },
    { key: "follower" as const, label: "Followers", count: counts.follower, on: "border-violet-800 bg-violet-950/60 text-violet-400" },
    { key: "mutual" as const, label: "Mutual", count: counts.mutual, on: "border-emerald-700 bg-emerald-950/60 text-emerald-400" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pills.map((p) => (
        <a
          key={p.label}
          href={href(p.key)}
          aria-current={active === p.key ? "page" : undefined}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
            active === p.key
              ? p.on
              : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-600 hover:text-white"
          }`}
        >
          {p.label}
          <span className="rounded-full bg-neutral-800/80 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-300">
            {p.count.toLocaleString()}
          </span>
        </a>
      ))}
    </div>
  );
}

export default async function NetworkPage(props: PageProps<"/network">) {
  const { owner, rel } = await props.searchParams;
  const ownerId = typeof owner === "string" && owner ? owner : null;
  const relation = parseRelation(rel);

  // Only the first page of cards is fetched here; UsersFeed pulls the rest
  // through /api/network as the grid scrolls.
  const [users, counts, totals, owners] = await Promise.all([
    loadSocialCards(ownerId, relation, 0, PAGE_SIZE),
    loadSocialCounts(ownerId),
    loadSocialTotals(ownerId, relation),
    loadOwners(),
  ]);

  return (
    <main className="min-h-screen bg-black px-6 py-12">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Following &amp; followers
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                Scraped X follow graph — separate data from the DM archive.
                An account can appear in both directions; it is one card
                either way.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/users"
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                DM accounts →
              </a>
              <a
                href="/posts"
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                Posts →
              </a>
              <OwnerPicker
                owners={owners}
                selected={ownerId}
                basePath="/network"
                extraParams={{ rel: relation }}
              />
            </div>
          </div>

          <RelationPills ownerId={ownerId} active={relation} counts={counts} />

          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-y border-neutral-900 py-4">
            {[
              ["Profiles", totals.profiles.toLocaleString()],
              ["Mutual", totals.mutual.toLocaleString()],
              ["Protected", totals.protected.toLocaleString()],
              ["Combined reach", compact(totals.combined_reach)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                  {label}
                </dt>
                <dd className="text-base font-semibold tabular-nums text-white">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        {totals.profiles === 0 ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-6 py-12 text-center text-sm text-neutral-500">
            No follow graph loaded for this selection — run{" "}
            <code className="text-neutral-400">
              supabase/load_social_graph.py
            </code>{" "}
            against an Apify follower-scraper export first.
          </p>
        ) : (
          <UsersFeed
            key={`${ownerId ?? "all"}:${relation ?? "all"}`}
            initialUsers={users}
            total={totals.profiles}
            pageSize={PAGE_SIZE}
            endpoint="/api/network"
            filters={{ owner: ownerId, rel: relation }}
          />
        )}
      </div>
    </main>
  );
}
