import { supabaseAdmin } from "@/lib/supabase";
import ChatButton from "./ChatButton";
import VoteButtons from "./VoteButtons";
import OwnerPicker, { type Owner } from "./OwnerPicker";

export const dynamic = "force-dynamic";

type UserRow = {
  rest_id: string;
  screen_name: string;
  name: string | null;
  description: string | null;
  location: string | null;
  followers: number | null;
  following: number | null;
  tweets: number | null;
  is_blue_verified: boolean | null;
  can_dm: boolean | null;
  avatar_url: string | null;
};

const COLUMNS =
  "rest_id,screen_name,name,description,location,followers,following,tweets,is_blue_verified,can_dm,avatar_url";

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

/** Counterparties belonging to one owner's archive. Null means every archive. */
async function loadCounterparties(
  ownerId: string | null
): Promise<Set<string> | null> {
  if (!ownerId) return null;

  const db = supabaseAdmin();
  const ids = new Set<string>();
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("dm_threads")
      .select("counterparty_id")
      .eq("owner_id", ownerId)
      .range(from, from + page - 1);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) ids.add(row.counterparty_id as string);
    if (!data || data.length < page) break;
  }
  return ids;
}

/**
 * Ids that sent at least one message with seq > 0 - i.e. they said something
 * after the opening message of the thread. Filters out bot/auto-reply accounts
 * whose only appearance is the first message.
 */
async function loadRealSenders(): Promise<Set<string>> {
  const db = supabaseAdmin();
  const senders = new Set<string>();
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("dm_messages")
      .select("sender_id")
      .gt("seq", 0)
      .range(from, from + page - 1);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) senders.add(row.sender_id as string);
    if (!data || data.length < page) break;
  }
  return senders;
}

/**
 * Scraped profiles that actually held a conversation, paged past PostgREST's
 * 1000-row ceiling. PostgREST has no EXISTS subquery, so the correlated half
 * is done as a set intersection here.
 */
async function loadUsers(ownerId: string | null): Promise<UserRow[]> {
  const db = supabaseAdmin();
  const [senders, scoped] = await Promise.all([
    loadRealSenders(),
    loadCounterparties(ownerId),
  ]);
  const out: UserRow[] = [];
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("user_info")
      .select(COLUMNS)
      .not("screen_name", "is", null)
      .order("followers", { ascending: false, nullsFirst: false })
      .range(from, from + page - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as UserRow[];
    out.push(
      ...rows.filter(
        (u) => senders.has(u.rest_id) && (!scoped || scoped.has(u.rest_id))
      )
    );
    if (!data || data.length < page) break;
  }
  return out;
}

type Vote = "like" | "dislike" | null;
/** Pill selection: a vote value, "none" for unrated, or null for all. */
type VoteFilter = "like" | "dislike" | "none" | null;

/** Existing votes, keyed by user id. */
async function loadVotes(): Promise<Map<string, Vote>> {
  const db = supabaseAdmin();
  const votes = new Map<string, Vote>();
  const page = 1000;

  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("user_votes")
      .select("user_id,liked,disliked")
      .range(from, from + page - 1);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      votes.set(row.user_id, row.liked ? "like" : row.disliked ? "dislike" : null);
    }
    if (!data || data.length < page) break;
  }
  return votes;
}

function compact(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}K`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function VerifiedBadge() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label="Verified"
      className="h-[18px] w-[18px] shrink-0 fill-sky-500"
    >
      <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
    </svg>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xl font-semibold tabular-nums text-white">
        {value}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </span>
    </div>
  );
}

function UserCard({
  user,
  index,
  vote,
}: {
  user: UserRow;
  index: number;
  vote: Vote;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-5 transition-colors hover:border-neutral-700">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-sky-500">
          Tracked account
        </span>
        <span className="font-mono text-[11px] tabular-nums text-neutral-500">
          {String(index + 1).padStart(3, "0")}
        </span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {user.avatar_url ? (
            /* Plain img on purpose: next/image would need remotePatterns for
               pbs.twimg.com, and these are small avatars already sized by X. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.avatar_url}
              alt=""
              width={44}
              height={44}
              loading="lazy"
              className="h-11 w-11 shrink-0 rounded-full bg-neutral-800 object-cover"
            />
          ) : (
            <div className="h-11 w-11 shrink-0 rounded-full bg-neutral-800" />
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-lg font-bold leading-tight text-white">
                {user.name || user.screen_name}
              </h2>
              {user.is_blue_verified && <VerifiedBadge />}
            </div>
            <p className="truncate font-mono text-[13px] text-neutral-500">
              @{user.screen_name}
            </p>
          </div>
        </div>

        <a
          href={`https://x.com/${user.screen_name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
        >
          Profile ↗
        </a>
      </div>

      <p className="line-clamp-3 min-h-[3.9rem] text-sm leading-relaxed text-neutral-400">
        {user.description || (
          <span className="text-neutral-600">No bio.</span>
        )}
      </p>

      <div className="grid grid-cols-3 gap-3 border-t border-neutral-800 pt-4">
        <Stat value={compact(user.followers)} label="Followers" />
        <Stat value={compact(user.following)} label="Following" />
        <Stat value={compact(user.tweets)} label="Tweets" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">

        {user.can_dm && (
          <span className="rounded border border-emerald-900 bg-emerald-950/40 px-1.5 py-0.5 text-emerald-500">
            DMs open
          </span>
        )}

        <VoteButtons userId={user.rest_id} initialVote={vote} />

        <ChatButton
          userId={user.rest_id}
          screenName={user.screen_name}
          name={user.name}
          avatarUrl={user.avatar_url}
        />
      </div>
    </article>
  );
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

  const [allUsers, votes, owners] = await Promise.all([
    loadUsers(ownerId),
    loadVotes(),
    loadOwners(),
  ]);

  const counts = {
    all: allUsers.length,
    like: allUsers.filter((u) => votes.get(u.rest_id) === "like").length,
    dislike: allUsers.filter((u) => votes.get(u.rest_id) === "dislike").length,
    // No row at all (undefined) and a cleared row (null) are both unrated.
    none: allUsers.filter((u) => !votes.get(u.rest_id)).length,
  };
  const users = voteFilter
    ? allUsers.filter((u) =>
        voteFilter === "none"
          ? !votes.get(u.rest_id)
          : votes.get(u.rest_id) === voteFilter
      )
    : allUsers;

  const totalFollowers = users.reduce((sum, u) => sum + (u.followers ?? 0), 0);
  const verified = users.filter((u) => u.is_blue_verified).length;
  const dmOpen = users.filter((u) => u.can_dm).length;

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
              ["Profiles", users.length.toLocaleString()],
              ["Verified", verified.toLocaleString()],
              ["DMs open", dmOpen.toLocaleString()],
              ["Combined reach", compact(totalFollowers)],
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

        {users.length === 0 && voteFilter ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-6 py-12 text-center text-sm text-neutral-500">
            No{" "}
            {voteFilter === "like"
              ? "liked"
              : voteFilter === "dislike"
                ? "disliked"
                : "unrated"}{" "}
            profiles yet.
          </p>
        ) : users.length === 0 ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-6 py-12 text-center text-sm text-neutral-500">
            No profiles yet — run the{" "}
            <a href="/scrape" className="text-sky-500 underline">
              scraper
            </a>{" "}
            first.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {users.map((user, i) => (
              <UserCard
                key={user.rest_id}
                user={user}
                index={i}
                vote={votes.get(user.rest_id) ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
