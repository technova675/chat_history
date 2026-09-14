-- Adds median_views and max_views to the post rollup, on a database that
-- already has data. user_posts.sql cannot be re-run for this: it starts by
-- dropping the user_posts table, which would throw away every scraped tweet.
--
-- Why the median: one viral post makes avg_views useless as "what a post of
-- theirs normally gets". Twenty posts in the hundreds plus one at 5.9M
-- average 296,970 - and read as a claim that the account reliably pulls
-- 300K, which it does not. The median of the same twenty is 765, which is
-- what the timeline actually looks like. avg_views is kept, unchanged.
--
-- Run this in the Supabase SQL editor, then re-run user_cards.sql and
-- network_posts_summary.sql (both drop and recreate, so order does not
-- matter). Safe to re-run. The rollup is a view, so every existing account
-- gets the new numbers immediately - nothing needs re-scraping.
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
  max(p.view_count)                           as max_views
from user_posts p
left join user_info u on u.rest_id = p.author_id
group by p.author_id, u.screen_name, u.name, u.followers;
