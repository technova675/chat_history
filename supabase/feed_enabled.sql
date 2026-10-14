-- Restrict /users to the 482 accounts the feed showed before 2026-09-17.
--
-- Background: user_cards inner-joins user_info and requires a non-null
-- screen_name, so a DM counterparty with no profile row never reaches the
-- feed. On 2026-09-17 a profile sweep filled in 443 counterparties that had
-- never been fetched, and the feed grew 482 -> 923.
--
-- Those 443 rows are honest: they come from the same premium-twitter-user-
-- scraper the DM side has always used (payload nests under `core`, carries
-- is_blue_verified and can_dm), NOT the follower scraper that
-- reset_leaked_placeholders.sql cleaned out. Nothing here is a placeholder.
--
-- So this is a presentation choice, not a data repair: the 441 accounts it
-- hides pass every test the other 482 pass. They are hidden because the feed
-- was asked to stay at its previous size, and a flag is how that is expressed
-- without throwing away profiles that cost money to fetch.
--
-- A flag rather than a delete, and default true rather than false: a future
-- sweep should not silently vanish, so new rows show up unless someone says
-- otherwise here.
--
-- Run the WHOLE file in the Supabase SQL editor. Safe to re-run.
-- To undo: update user_info set feed_enabled = true; then re-run user_cards.sql.

alter table user_info
  add column if not exists feed_enabled boolean not null default true;

comment on column user_info.feed_enabled is
  'False hides the account from user_cards (and so from /users) without
   deleting its profile. Set for the 2026-09-17 sweep to hold the feed at 482.';

-- The sweep is identified by fetch time: every pre-existing ok row was
-- fetched earlier, and the one not_found from that batch is already excluded
-- by the screen_name test, so it does not matter either way.
update user_info
   set feed_enabled = false
 where fetch_status = 'ok'
   and fetched_at  >= '2026-09-17';

-- Recreate the view with the flag applied. Body is otherwise identical to
-- user_cards.sql - keep the two in step if either changes.
drop view if exists user_cards cascade;

create view user_cards as
select
  u.rest_id, u.screen_name, u.name, u.description, u.location,
  u.followers, u.following, u.tweets, u.is_blue_verified, u.can_dm,
  u.avatar_url,
  array_agg(distinct t.owner_id) as owner_ids,
  max(s.posts)        as posts,
  max(s.total_views)  as total_views,
  max(s.avg_views)    as avg_views,
  max(s.median_views) as median_views,
  max(s.max_views)    as max_views,
  coalesce((select array_agg(v.owner_id) from user_votes v
            where v.user_id = u.rest_id and v.owner_id is not null and v.liked),
           '{}'::text[]) as liked_by,
  coalesce((select array_agg(v.owner_id) from user_votes v
            where v.user_id = u.rest_id and v.owner_id is not null and v.disliked),
           '{}'::text[]) as disliked_by,
  coalesce((select array_agg(f.owner_id) from user_formats f
            where f.user_id = u.rest_id and f.owner_id is not null and f.heygen),
           '{}'::text[]) as heygen_by,
  coalesce((select array_agg(f.owner_id) from user_formats f
            where f.user_id = u.rest_id and f.owner_id is not null and f.text_format),
           '{}'::text[]) as text_by,
  coalesce((select array_agg(f.owner_id) from user_formats f
            where f.user_id = u.rest_id and f.owner_id is not null and f.personal),
           '{}'::text[]) as personal_by
from dm_threads t
join user_info u
  on u.rest_id = t.counterparty_id
 and u.screen_name is not null
 and u.feed_enabled
left join user_posts_summary s on s.author_id = u.rest_id
where exists (
  select 1 from dm_messages m
  where m.sender_id = u.rest_id and m.seq > 0
)
group by
  u.rest_id, u.screen_name, u.name, u.description, u.location,
  u.followers, u.following, u.tweets, u.is_blue_verified, u.can_dm,
  u.avatar_url;

comment on view user_cards is
  'Feed behind /users: DM counterparties who actually replied, with their post
   rollup and vote already joined, limited to feed_enabled profiles. Page it
   with limit/offset ordered by followers desc; filter one archive with
   owner_ids=cs.{<owner_id>}.';

-- user_card_totals reads user_cards, which the cascade above dropped.
drop function if exists user_card_totals(text, text);
create or replace function user_card_totals(
  p_owner text default null
)
returns table (
  profiles bigint, verified bigint, dm_open bigint, combined_reach bigint
)
language sql
stable
as $$
  select
    count(*)                                   as profiles,
    count(*) filter (where c.is_blue_verified) as verified,
    count(*) filter (where c.can_dm)           as dm_open,
    coalesce(sum(c.followers), 0)::bigint      as combined_reach
  from user_cards c
  where (p_owner is null or c.owner_ids @> array[p_owner]);
$$;

-- Should be 482.
select count(*) as user_cards_rows from user_cards;
-- Should be 443: every row the sweep added. Two of them never reached the
-- feed anyway (not DM counterparties who replied), which is why the card
-- count falls by 441 and not 443.
select count(*) as hidden from user_info where not feed_enabled;
