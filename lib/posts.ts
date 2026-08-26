/**
 * Shared shape for the Apify tweet actor's output, and the mapping into the
 * user_posts columns. Used by both the import route and any script that
 * loads a dataset dump from disk.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ApifyTweet = Record<string, any>;

export type PostRow = {
  tweet_id: string;
  author_id: string;
  author_username: string | null;
  text: string | null;
  lang: string | null;
  url: string | null;
  posted_at: string;
  reply_count: number;
  retweet_count: number;
  quote_count: number;
  like_count: number;
  bookmark_count: number;
  view_count: number | null;
  conversation_id: string | null;
  is_reply: boolean;
  in_reply_to_id: string | null;
  in_reply_to_user_id: string | null;
  in_reply_to_username: string | null;
  is_pinned: boolean;
  media_count: number;
  media_types: string[];
  raw: ApifyTweet;
  fetched_at: string;
};

/** "Tue Aug 25 06:39:45 +0000 2026" -> ISO, or null if unparseable. */
export function parseTwitterDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const int = (v: unknown): number => (typeof v === "number" ? v : 0);

/**
 * Flatten one actor item into a user_posts row. Returns null for anything
 * unusable - the actor mixes in non-tweet items, and posted_at is NOT NULL.
 */
export function toPostRow(tweet: ApifyTweet, fetchedAt: string): PostRow | null {
  const id = tweet?.id;
  const authorId = tweet?.author?.id;
  const postedAt = parseTwitterDate(tweet?.createdAt);

  if (!id || !authorId || !postedAt) return null;

  const media = Array.isArray(tweet.extendedEntities?.media)
    ? tweet.extendedEntities.media
    : [];

  return {
    tweet_id: String(id),
    author_id: String(authorId),
    author_username: tweet.author?.userName ?? null,
    text: tweet.text ?? null,
    lang: tweet.lang ?? null,
    url: tweet.url ?? null,
    posted_at: postedAt,
    reply_count: int(tweet.replyCount),
    retweet_count: int(tweet.retweetCount),
    quote_count: int(tweet.quoteCount),
    like_count: int(tweet.likeCount),
    bookmark_count: int(tweet.bookmarkCount),
    view_count: typeof tweet.viewCount === "number" ? tweet.viewCount : null,
    conversation_id: tweet.conversationId ? String(tweet.conversationId) : null,
    is_reply: Boolean(tweet.isReply),
    in_reply_to_id: tweet.inReplyToId ? String(tweet.inReplyToId) : null,
    in_reply_to_user_id: tweet.inReplyToUserId
      ? String(tweet.inReplyToUserId)
      : null,
    in_reply_to_username: tweet.inReplyToUsername ?? null,
    is_pinned: Boolean(tweet.isPinned),
    media_count: media.length,
    media_types: [
      ...new Set(media.map((m: any) => m?.type).filter(Boolean) as string[]),
    ],
    raw: tweet,
    fetched_at: fetchedAt,
  };
}

/**
 * Map a whole dataset, dropping unusable items and collapsing duplicate
 * tweet_ids - a single upsert call cannot touch the same primary key twice.
 */
export function toPostRows(tweets: ApifyTweet[]): {
  rows: PostRow[];
  skipped: number;
  duplicates: number;
} {
  const fetchedAt = new Date().toISOString();
  const byId = new Map<string, PostRow>();
  let skipped = 0;
  let duplicates = 0;

  for (const tweet of tweets) {
    const row = toPostRow(tweet, fetchedAt);
    if (!row) {
      skipped++;
      continue;
    }
    if (byId.has(row.tweet_id)) duplicates++;
    byId.set(row.tweet_id, row);
  }

  return { rows: [...byId.values()], skipped, duplicates };
}
