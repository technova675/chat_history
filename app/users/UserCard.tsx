"use client";

import VoteButtons from "./VoteButtons";
import ChatButton from "./ChatButton";
import { compact } from "@/lib/format";

/** One row of the user_cards view. */
export type CardRow = {
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
  posts: number | null;
  total_views: number | null;
  avg_views: number | null;
  vote: "like" | "dislike" | "none";
};

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

/** Stacked-lines glyph, matching the metric icon X uses for post views. */
function PostIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5 fill-current"
    >
      <path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z" />
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

export default function UserCard({
  user,
  index,
}: {
  user: CardRow;
  index: number;
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
        {user.description || <span className="text-neutral-600">No bio.</span>}
      </p>

      <div className="grid grid-cols-3 gap-3 border-t border-neutral-800 pt-4">
        <Stat value={compact(user.followers)} label="Followers" />
        <Stat value={compact(user.following)} label="Following" />
        <Stat value={compact(user.tweets)} label="Tweets" />
      </div>

      {/* Scraped-post rollup. Dashes rather than zeros when the account has
          not been scraped: not yet scraped is not the same as no engagement. */}
      <div className="grid grid-cols-3 gap-3">
        <Stat value={compact(user.posts)} label="Posts" />
        <Stat value={compact(user.total_views)} label="Total views" />
        <Stat value={compact(user.avg_views)} label="Avg views" />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
        {user.can_dm && (
          <span className="rounded border border-emerald-900 bg-emerald-950/40 px-1.5 py-0.5 text-emerald-500">
            DMs open
          </span>
        )}

        <VoteButtons
          userId={user.rest_id}
          initialVote={user.vote === "none" ? null : user.vote}
        />

        {/* ml-auto lives here, not on ChatButton: the pair is pushed right
            together rather than being split apart by two auto margins. */}
        <a
          href={`/user_post?userId=${user.rest_id}`}
          className="ml-auto inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
        >
          <PostIcon />
          Posts
        </a>

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
