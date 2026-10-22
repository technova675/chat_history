-- Adds last_fetched_at to the post rollup: when this account's posts were
-- last fetched. /network shows it on each card, and its latest across an
-- owner's graph in the header, as "data up to" that date.
--
-- max(fetched_at), not max(posted_at): a quiet account's newest post can be
-- weeks old while its timeline was fetched yesterday. last_post_at is that
-- other date and is unchanged.
--
-- Run this in the Supabase SQL editor. Safe to re-run. The column goes on the
-- end, so `create or replace` keeps user_cards and network_posts_summary - no
-- need to re-run either.
--
-- The view body below must stay identical to the one at the end of
-- user_posts.sql, which is where it lives for a fresh database.

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
  max(p.posted_at)                            as last_post_at,
  round(
    percentile_cont(0.5) within group (order by p.view_count)
  )::bigint                                   as median_views,
  max(p.view_count)                           as max_views,
  max(p.fetched_at)                           as last_fetched_at
from user_posts p
left join user_info u on u.rest_id = p.author_id
group by p.author_id, u.screen_name, u.name, u.followers;
