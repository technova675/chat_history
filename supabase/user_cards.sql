-- One row per account shown on /users, assembled in Postgres instead of by
-- intersecting three full-table reads in JS. Lets the page fetch 20 rows at a
-- time rather than every profile on every visit.
--
-- Requires: schema.sql, owners.sql, add_owner_id.sql, user_info.sql,
--           user_posts.sql, user_votes, user_formats.sql, votes_by_owner.sql.
-- Run in the Supabase SQL editor. Safe to re-run.

-- Dropped rather than replaced: `create or replace view` refuses a changed
-- column list, and this one grows whenever the post rollup does.
drop view if exists user_cards cascade;

create view user_cards as
select
  u.rest_id,
  u.screen_name,
  u.name,
  u.description,
  u.location,
  u.followers,
  u.following,
  u.tweets,
  u.is_blue_verified,
  u.can_dm,
  u.avatar_url,

  -- Which archives this account appears in. An array rather than one row per
  -- owner: a counterparty shared by two owners must still be a single card.
  -- Filter with PostgREST's contains operator: owner_ids=cs.{<owner_id>}
  array_agg(distinct t.owner_id) as owner_ids,

  -- Post-scrape rollup. Null until their tweets are scraped, which the UI
  -- renders as a dash rather than a zero.
  -- median_views is the one the card shows: see the note in user_posts.sql
  -- for why the mean is not the typical post. max_views carries the account's
  -- best post so a viral hit stays visible as itself.
  max(s.posts)        as posts,
  max(s.total_views)  as total_views,
  max(s.avg_views)    as avg_views,
  max(s.median_views) as median_views,
  max(s.max_views)    as max_views,

  -- Votes and format picks are per owner (votes_by_owner.sql): each column is
  -- the owners who made that choice. '{}' rather than null when nobody has, so
  -- the pills can filter with cs / not cs / eq '{}' without a null case.
  -- Rows from before votes were per owner have no owner_id and are left out.
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
left join user_posts_summary s on s.author_id = u.rest_id
-- Said something after the opening message: filters out bots and auto-replies.
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
   rollup and vote already joined. Page it with limit/offset ordered by
   followers desc; filter one archive with owner_ids=cs.{<owner_id>}.';

-- Header totals for /users. A function, not a view: PostgREST can count rows
-- but cannot sum a column, and the header needs combined reach.
-- p_owner null = every archive. The vote filter it used to take went when
-- votes became per owner; loadTotals in lib/userCards.ts does the filtered
-- totals.
drop function if exists user_card_totals(text, text);
create or replace function user_card_totals(
  p_owner text default null
)
returns table (
  profiles       bigint,
  verified       bigint,
  dm_open        bigint,
  combined_reach bigint
)
language sql
stable
as $$
  select
    count(*)                                         as profiles,
    count(*) filter (where c.is_blue_verified)       as verified,
    count(*) filter (where c.can_dm)                 as dm_open,
    coalesce(sum(c.followers), 0)::bigint            as combined_reach
  from user_cards c
  where (p_owner is null or c.owner_ids @> array[p_owner]);
$$;
