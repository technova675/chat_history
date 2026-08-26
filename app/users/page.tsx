import { supabaseAdmin } from "@/lib/supabase";
import OwnerPicker, { type Owner } from "./OwnerPicker";
import UsersFeed from "./UsersFeed";
import { compact } from "@/lib/format";
import {
  loadCards,
  loadCounts,
  loadTotals,
  PAGE_SIZE,
  type VoteFilter,
} from "@/lib/userCards";

export const dynamic = "force-dynamic";

/** Archive owners, for the dropdown. */
async function loadOwners(): Promise<Owner[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("owners")
    .select("owner_id,screen_name,name,avatar_url,is_blue_verified")
    .order("screen_name");

  if (error) throw new Error(error.message);
  return (data ?? []) as Owner[];
}

/** Link-based vote filter pills. Preserves the owner selection. */
function VoteFilterPills({
  ownerId,
  active,
  counts,
}: {
  ownerId: string | null;
  active: VoteFilter;
  counts: { all: number; like: number; dislike: number; none: number };
}) {
  const href = (vote: VoteFilter) => {
    const params = new URLSearchParams();
    if (ownerId) params.set("owner", ownerId);
    if (vote) params.set("vote", vote);
    const qs = params.toString();
    return qs ? `/users?${qs}` : "/users";
  };

  const pills = [
    { key: null, label: "All", count: counts.all, on: "border-neutral-500 bg-neutral-800 text-white" },
    { key: "like" as const, label: "Liked", count: counts.like, on: "border-emerald-700 bg-emerald-950/60 text-emerald-400" },
    { key: "dislike" as const, label: "Disliked", count: counts.dislike, on: "border-red-800 bg-red-950/60 text-red-400" },
    { key: "none" as const, label: "Unrated", count: counts.none, on: "border-amber-800 bg-amber-950/60 text-amber-400" },
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

export default async function UsersPage(props: PageProps<"/users">) {
  const { owner, vote } = await props.searchParams;
  const ownerId = typeof owner === "string" && owner ? owner : null;
  const voteFilter: VoteFilter =
    vote === "like" || vote === "dislike" || vote === "none" ? vote : null;

  // Only the first page of cards is fetched here; UsersFeed pulls the rest
  // through /api/users as the grid scrolls.
  const [users, counts, totals, owners] = await Promise.all([
    loadCards(ownerId, voteFilter, 0, PAGE_SIZE),
    loadCounts(ownerId),
    loadTotals(ownerId, voteFilter),
    loadOwners(),
  ]);

  return (
    <main className="min-h-screen bg-black px-6 py-12">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Tracked accounts
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                Scraped X profiles from your DM history.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/posts"
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                Posts →
              </a>
              <a
                href="/scrape"
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                Scraper →
              </a>
              <OwnerPicker owners={owners} selected={ownerId} />
            </div>
          </div>

          <VoteFilterPills
            ownerId={ownerId}
            active={voteFilter}
            counts={counts}
          />

          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-y border-neutral-900 py-4">
            {[
              ["Profiles", totals.profiles.toLocaleString()],
              ["Verified", totals.verified.toLocaleString()],
              ["DMs open", totals.dm_open.toLocaleString()],
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

        {totals.profiles === 0 && voteFilter ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-6 py-12 text-center text-sm text-neutral-500">
            No{" "}
            {voteFilter === "like"
              ? "liked"
              : voteFilter === "dislike"
                ? "disliked"
                : "unrated"}{" "}
            profiles yet.
          </p>
        ) : totals.profiles === 0 ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-6 py-12 text-center text-sm text-neutral-500">
            No profiles yet — run the{" "}
            <a href="/scrape" className="text-sky-500 underline">
              scraper
            </a>{" "}
            first.
          </p>
        ) : (
          <UsersFeed
            key={`${ownerId ?? "all"}:${voteFilter ?? "all"}`}
            initialUsers={users}
            total={totals.profiles}
            pageSize={PAGE_SIZE}
            ownerId={ownerId}
            vote={voteFilter}
          />
        )}
      </div>
    </main>
  );
}
