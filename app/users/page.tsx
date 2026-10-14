import { supabaseAdmin } from "@/lib/supabase";
import OwnerPicker, { type Owner } from "./OwnerPicker";
import UsersFeed from "./UsersFeed";
import SortPicker from "./SortPicker";
import { ActorProvider } from "./ActorContext";
import { compact } from "@/lib/format";
import { parseActor } from "@/lib/actors";
import {
  loadCards,
  loadCounts,
  loadTotals,
  parseExtraFilter,
  parseSort,
  PAGE_SIZE,
  DEFAULT_SORT,
  type ExtraFilter,
  type SortKey,
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

/**
 * Link-based filter pills. Preserves the owner selection.
 *
 * One pill is on at a time, as on /network: Common and the three formats are
 * their own selection (`?filter=`) rather than toggles layered over a vote.
 */
type PillKey = VoteFilter | Exclude<ExtraFilter, null>;

function VoteFilterPills({
  ownerId,
  active,
  extra,
  sort,
  counts,
}: {
  ownerId: string | null;
  active: VoteFilter;
  extra: ExtraFilter;
  sort: SortKey;
  counts: {
    all: number;
    like: number;
    dislike: number;
    none: number;
    common: number;
    heygen: number;
    text: number;
    personal: number;
  };
}) {
  const isExtra = (key: PillKey): key is Exclude<ExtraFilter, null> =>
    key === "common" || key === "heygen" || key === "text" || key === "personal";

  const href = (key: PillKey) => {
    const params = new URLSearchParams();
    if (ownerId) params.set("owner", ownerId);
    if (key && isExtra(key)) params.set("filter", key);
    else if (key) params.set("vote", key);
    if (sort !== DEFAULT_SORT) params.set("sort", sort);
    const qs = params.toString();
    return qs ? `/users?${qs}` : "/users";
  };

  const pills = [
    { key: null, label: "All", count: counts.all, on: "border-neutral-500 bg-neutral-800 text-white" },
    { key: "like" as const, label: "Liked", count: counts.like, on: "border-emerald-700 bg-emerald-950/60 text-emerald-400" },
    { key: "dislike" as const, label: "Disliked", count: counts.dislike, on: "border-red-800 bg-red-950/60 text-red-400" },
    { key: "none" as const, label: "Unrated", count: counts.none, on: "border-amber-800 bg-amber-950/60 text-amber-400" },
    // In the DM archives of two or more owners.
    { key: "common" as const, label: "Common", count: counts.common, on: "border-fuchsia-800 bg-fuchsia-950/60 text-fuchsia-400" },
    // Format flags, in the colours of the card's own format buttons.
    { key: "heygen" as const, label: "HeyGen", count: counts.heygen, on: "border-violet-700 bg-violet-950/60 text-violet-300" },
    { key: "text" as const, label: "Text", count: counts.text, on: "border-amber-700 bg-amber-950/60 text-amber-300" },
    { key: "personal" as const, label: "Personal", count: counts.personal, on: "border-teal-700 bg-teal-950/60 text-teal-300" },
  ];

  const isActive = (key: PillKey) =>
    key && isExtra(key) ? extra === key : !extra && active === key;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pills.map((p) => (
        <a
          key={p.label}
          href={href(p.key)}
          aria-current={isActive(p.key) ? "page" : undefined}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
            isActive(p.key)
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
  const { owner, vote, filter, sort: sortParam } = await props.searchParams;
  const ownerId = typeof owner === "string" && owner ? owner : null;
  const extra = parseExtraFilter(filter);
  // ?filter= and the vote pills are exclusive, so a stale vote is dropped.
  const voteFilter: VoteFilter =
    !extra && (vote === "like" || vote === "dislike" || vote === "none")
      ? vote
      : null;
  const sort = parseSort(sortParam);
  // Votes and format picks are saved for the selected owner, and the pills
  // and the cards' buttons show theirs. On "All" a click asks which owner.
  const actor = parseActor(ownerId);

  // Only the first page of cards is fetched here; UsersFeed pulls the rest
  // through /api/users as the grid scrolls.
  const [users, counts, totals, owners] = await Promise.all([
    loadCards(ownerId, voteFilter, 0, PAGE_SIZE, sort, extra, actor),
    loadCounts(ownerId, actor),
    loadTotals(ownerId, voteFilter, extra, actor),
    loadOwners(),
  ]);

  return (
    <ActorProvider actor={actor}>
    <main className="min-h-screen bg-black px-6 py-12">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8">
        {/* Sticky, like /network: the pills and the owner picker are the
            controls for the grid below, and scrolling a few hundred cards
            should not put them out of reach. -mx-6/px-6 bleeds the background
            over the padding on <main> so cards do not show up the sides as
            they pass underneath, and -mt-12/pt-12 covers its top padding. */}
        <header className="sticky top-0 z-30 -mx-6 -mt-12 flex flex-col gap-4 border-b border-neutral-900 bg-black/95 px-6 pb-4 pt-12 backdrop-blur">
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
                href="/network"
                className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                Network →
              </a>
              {/* <a
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
              </a> */}
              <OwnerPicker
                owners={owners}
                selected={ownerId}
                extraParams={{
                  vote: voteFilter,
                  filter: extra,
                  sort: sort === DEFAULT_SORT ? null : sort,
                }}
              />
            </div>
          </div>

          <VoteFilterPills
            ownerId={ownerId}
            active={voteFilter}
            extra={extra}
            sort={sort}
            counts={counts}
          />

          <SortPicker
            basePath="/users"
            active={sort}
            extraParams={{
              owner: ownerId,
              vote: voteFilter,
              filter: extra,
            }}
          />

          <dl className="flex flex-wrap gap-x-10 gap-y-3 border-t border-neutral-900 pt-4">
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

        {totals.profiles === 0 && extra ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-6 py-12 text-center text-sm text-neutral-500">
            {extra === "common"
              ? "No accounts appear in more than one archive."
              : `No profiles marked ${
                  extra === "heygen"
                    ? "HeyGen"
                    : extra === "text"
                      ? "Text"
                      : "Personal"
                } yet.`}
          </p>
        ) : totals.profiles === 0 && voteFilter ? (
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
            key={`${ownerId ?? "all"}:${extra ?? voteFilter ?? "all"}:${sort}`}
            initialUsers={users}
            total={totals.profiles}
            pageSize={PAGE_SIZE}
            endpoint="/api/users"
            filters={{
              owner: ownerId,
              vote: voteFilter,
              filter: extra,
              sort,
            }}
          />
        )}
      </div>
    </main>
    </ActorProvider>
  );
}
