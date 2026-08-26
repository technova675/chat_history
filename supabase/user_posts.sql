-- Tweets scraped per user via the Apify tweet actor.
-- One row per tweet. The `author` block in the JSON is a snapshot of the
-- poster's profile at scrape time and is redundant with user_info, so only
-- author_id is kept as a column; the rest stays in `raw`.
-- Run in the Supabase SQL editor. Safe to re-run.

drop table if exists user_posts cascade;

create table user_posts (
  tweet_id         text primary key,

  -- who posted it. Soft reference to user_info.rest_id: posts can be scraped
  -- for an account before (or without) its profile being fetched, so no FK.
  author_id        text not null,
  author_username  text,

  -- content
  text             text,
  lang             text,
  url              text,
  posted_at        timestamptz not null,

  -- engagement, as of fetched_at. These move, so a re-import overwrites them.
  reply_count      integer not null default 0,
  retweet_count    integer not null default 0,
  quote_count      integer not null default 0,
  like_count       integer not null default 0,
  bookmark_count   integer not null default 0,
  view_count       bigint,

  -- thread / reply shape
  conversation_id  text,
  is_reply         boolean not null default false,
  in_reply_to_id   text,
  in_reply_to_user_id text,
  in_reply_to_username text,
  is_pinned        boolean not null default false,

  -- media, flattened out of extendedEntities.media
  media_count      integer not null default 0,
  media_types      text[] not null default '{}',

  -- provenance
  raw              jsonb,
  fetched_at       timestamptz not null default now()
);

comment on column user_posts.author_id is
  'Tweet author rest_id. Matches user_info.rest_id and dm_threads.counterparty_id.';
comment on column user_posts.view_count is
  'bigint, not integer: view counts on a viral tweet exceed 2.1B.';
comment on column user_posts.media_types is
  'Distinct media types on the tweet: photo, video, animated_gif. Empty for text-only.';

create index user_posts_author_idx       on user_posts (author_id, posted_at desc);
create index user_posts_posted_idx       on user_posts (posted_at desc);
create index user_posts_likes_idx        on user_posts (like_count desc nulls last);
create index user_posts_views_idx        on user_posts (view_count desc nulls last);
create index user_posts_conversation_idx on user_posts (conversation_id);
create index user_posts_has_media_idx    on user_posts (author_id) where media_count > 0;

alter table user_posts enable row level security;

-- Per-author rollup: what the timeline looks like in aggregate.
create or replace view user_posts_summary as
select
  p.author_id,
  u.screen_name,
  u.name,
  u.followers,
  count(*)                                    as posts,
  count(*) filter (where p.is_reply)          as replies,
  count(*) filter (where p.media_count > 0)   as with_media,
  sum(p.like_count)                           as total_likes,
  sum(p.view_count)                           as total_views,
  round(avg(p.like_count))                    as avg_likes,
  round(avg(p.view_count))                    as avg_views,
  min(p.posted_at)                            as first_post_at,
  max(p.posted_at)                            as last_post_at
from user_posts p
left join user_info u on u.rest_id = p.author_id
group by p.author_id, u.screen_name, u.name, u.followers;
