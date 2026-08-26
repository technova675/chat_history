import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Profile = {
  rest_id: string;
  screen_name: string;
  name: string | null;
  description: string | null;
  location: string | null;
  website: string | null;
  account_created_at: string | null;
  followers: number | null;
  following: number | null;
  tweets: number | null;
  is_blue_verified: boolean | null;
  avatar_url: string | null;
  banner_url: string | null;
};

type Post = {
  tweet_id: string;
  text: string | null;
  url: string | null;
  posted_at: string;
  reply_count: number;
  retweet_count: number;
  quote_count: number;
  like_count: number;
  bookmark_count: number;
  view_count: number | null;
  is_pinned: boolean;
  media_count: number;
  media_types: string[];
};

type Summary = {
  posts: number;
  replies: number;
  with_media: number;
  total_likes: number | null;
  total_views: number | null;
  avg_likes: number | null;
  avg_views: number | null;
  first_post_at: string | null;
  last_post_at: string | null;
};

const PROFILE_COLUMNS =
  "rest_id,screen_name,name,description,location,website,account_created_at," +
  "followers,following,tweets,is_blue_verified,avatar_url,banner_url";

const POST_COLUMNS =
  "tweet_id,text,url,posted_at,reply_count,retweet_count,quote_count," +
  "like_count,bookmark_count,view_count,is_pinned,media_count,media_types";

async function loadProfile(userId: string): Promise<Profile | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("user_info")
    .select(PROFILE_COLUMNS)
    .eq("rest_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data ?? null) as Profile | null;
}

/** Pinned first, then newest - the order X itself uses on a profile. */
async function loadPosts(userId: string): Promise<Post[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("user_posts")
    .select(POST_COLUMNS)
    .eq("author_id", userId)
    .order("is_pinned", { ascending: false })
    .order("posted_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Post[];
}

async function loadSummary(userId: string): Promise<Summary | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("user_posts_summary")
    .select("posts,replies,with_media,total_likes,total_views,avg_likes,avg_views,first_post_at,last_post_at")
    .eq("author_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data ?? null) as Summary | null;
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

/** "Jul 19" for this year, "Jul 19, 2025" otherwise - X's own convention. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function joinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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

/** The four engagement icons under a tweet, in X's order. */
function Metric({
  path,
  value,
  label,
}: {
  path: string;
  value: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-current">
        <path d={path} />
      </svg>
      <span className="tabular-nums">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const ICONS = {
  reply:
    "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
  retweet:
    "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2h6.5v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H10V4h6.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
  like:
    "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91z",
  views:
    "M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z",
} as const;

export default async function UserPostsPage(props: PageProps<"/user_post">) {
  const { userId } = await props.searchParams;
  const id = typeof userId === "string" ? userId : "";

  if (!id) {
    return (
      <Shell>
        <p className="px-5 py-12 text-center text-sm text-neutral-500">
          No account selected. Open this page from a card on{" "}
          <a href="/users" className="text-sky-500 underline">
            /users
          </a>
          .
        </p>
      </Shell>
    );
  }

  const [profile, posts, summary] = await Promise.all([
    loadProfile(id),
    loadPosts(id),
    loadSummary(id),
  ]);

  if (!profile) {
    return (
      <Shell>
        <p className="px-5 py-12 text-center text-sm text-neutral-500">
          No profile stored for id <span className="font-mono">{id}</span>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Sticky header, as on X: back arrow, name, post count. */}
      <header className="sticky top-0 z-10 flex items-center gap-6 border-b border-neutral-800 bg-black/80 px-4 py-2 backdrop-blur">
        <a
          href="/users"
          aria-label="Back to accounts"
          className="rounded-full px-2 py-1 text-xl leading-none text-neutral-200 transition-colors hover:bg-neutral-900"
        >
          ←
        </a>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-lg font-bold text-white">
              {profile.name || profile.screen_name}
            </h1>
            {profile.is_blue_verified && <VerifiedBadge />}
          </div>
          <p className="text-[13px] text-neutral-500">
            {summary?.posts ?? 0} posts scraped
          </p>
        </div>
      </header>

      {profile.banner_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={profile.banner_url}
          alt=""
          className="h-40 w-full bg-neutral-900 object-cover sm:h-52"
        />
      ) : (
        <div className="h-40 w-full bg-neutral-900 sm:h-52" />
      )}

      <div className="px-4 pb-4">
        <div className="flex items-start justify-between">
          {profile.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.avatar_url}
              alt=""
              className="-mt-14 h-28 w-28 rounded-full border-4 border-black bg-neutral-800 object-cover sm:-mt-16 sm:h-32 sm:w-32"
            />
          ) : (
            <div className="-mt-14 h-28 w-28 rounded-full border-4 border-black bg-neutral-800 sm:-mt-16 sm:h-32 sm:w-32" />
          )}

          <a
            href={`https://x.com/${profile.screen_name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black transition-colors hover:bg-neutral-200"
          >
            View on X ↗
          </a>
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-extrabold text-white">
              {profile.name || profile.screen_name}
            </h2>
            {profile.is_blue_verified && <VerifiedBadge />}
          </div>
          <p className="text-[15px] text-neutral-500">@{profile.screen_name}</p>
        </div>

        {profile.description && (
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-200">
            {profile.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-neutral-500">
          {profile.location && <span>📍 {profile.location}</span>}
          {profile.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-500 hover:underline"
            >
              🔗 {profile.website.replace(/^https?:\/\//, "")}
            </a>
          )}
          {profile.account_created_at && (
            <span>🗓 Joined {joinedDate(profile.account_created_at)}</span>
          )}
        </div>

        <div className="mt-3 flex gap-5 text-[15px]">
          <span className="text-neutral-500">
            <span className="font-bold text-white">
              {compact(profile.following)}
            </span>{" "}
            Following
          </span>
          <span className="text-neutral-500">
            <span className="font-bold text-white">
              {compact(profile.followers)}
            </span>{" "}
            Followers
          </span>
        </div>

        {/* Rollup from user_posts_summary - the scrape's own numbers, which
            is what this page adds over the real profile on X. */}
        {summary && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
            {[
              ["Posts", compact(summary.posts)],
              ["Total views", compact(summary.total_views)],
              ["Avg views", compact(summary.avg_views)],
              ["Total likes", compact(summary.total_likes)],
              ["Avg likes", compact(summary.avg_likes)],
              ["With media", compact(summary.with_media)],
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
        )}
      </div>

      <nav className="flex border-b border-neutral-800 text-[15px] font-medium text-neutral-500">
        <span className="relative px-6 py-4 font-bold text-white">
          Posts
          <span className="absolute inset-x-4 bottom-0 h-1 rounded-full bg-sky-500" />
        </span>
        <span className="px-6 py-4">Replies</span>
        <span className="px-6 py-4">Media</span>
      </nav>

      {posts.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-neutral-500">
          No posts scraped for @{profile.screen_name} yet — run the{" "}
          <a href="/posts" className="text-sky-500 underline">
            post scraper
          </a>
          .
        </p>
      ) : (
        <ol>
          {posts.map((post) => (
            <li
              key={post.tweet_id}
              className="border-b border-neutral-800 px-4 py-3 transition-colors hover:bg-neutral-950"
            >
              {post.is_pinned && (
                <p className="mb-1 pl-8 text-[13px] font-semibold text-neutral-500">
                  📌 Pinned
                </p>
              )}

              <div className="flex gap-3">
                {profile.avatar_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full bg-neutral-800 object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-full bg-neutral-800" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1 text-[15px]">
                    <span className="font-bold text-white">
                      {profile.name || profile.screen_name}
                    </span>
                    {profile.is_blue_verified && <VerifiedBadge />}
                    <span className="text-neutral-500">
                      @{profile.screen_name} · {shortDate(post.posted_at)}
                    </span>
                  </p>

                  <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-100">
                    {post.text}
                  </p>

                  {post.media_count > 0 && (
                    <p className="mt-2 inline-flex items-center gap-2 rounded-lg border border-neutral-800 px-3 py-1.5 text-[13px] text-neutral-500">
                      {post.media_types.join(", ") || "media"} ×{" "}
                      {post.media_count}
                    </p>
                  )}

                  <div className="mt-3 flex max-w-md items-center justify-between text-[13px] text-neutral-500">
                    <Metric
                      path={ICONS.reply}
                      value={compact(post.reply_count)}
                      label="replies"
                    />
                    <Metric
                      path={ICONS.retweet}
                      value={compact(post.retweet_count + post.quote_count)}
                      label="reposts and quotes"
                    />
                    <Metric
                      path={ICONS.like}
                      value={compact(post.like_count)}
                      label="likes"
                    />
                    <Metric
                      path={ICONS.views}
                      value={compact(post.view_count)}
                      label="views"
                    />
                    {post.url && (
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-colors hover:text-sky-500"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Shell>
  );
}

/** X's single-column layout: a bordered feed centred on a black page. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black">
      <div className="mx-auto w-full max-w-[640px] border-x border-neutral-800">
        {children}
      </div>
    </main>
  );
}
