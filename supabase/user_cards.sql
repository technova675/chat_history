-- One row per account shown on /users, assembled in Postgres instead of by
-- intersecting three full-table reads in JS. Lets the page fetch 20 rows at a
-- time rather than every profile on every visit.
--
-- Requires: schema.sql, owners.sql, add_owner_id.sql, user_info.sql,
--           user_posts.sql, user_votes.
-- Run in the Supabase SQL editor. Safe to re-run.

create or replace view user_cards as
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
  max(s.posts)       as posts,
  max(s.total_views) as total_views,
  max(s.avg_views)   as avg_views,

  -- Vote, folded to a single value so the pills can filter in SQL.
  -- 'none' rather than null keeps the filter a plain equality test.
  coalesce(max(
    case when v.liked then 'like' when v.disliked then 'dislike' end
  ), 'none') as vote

from dm_threads t
join user_info u
  on u.rest_id = t.counterparty_id
 and u.screen_name is not null
left join user_posts_summary s on s.author_id = u.rest_id
left join user_votes v         on v.user_id   = u.rest_id
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
-- p_owner null = every archive; p_vote null = every vote state.
create or replace function user_card_totals(
  p_owner text default null,
  p_vote  text default null
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
  where (p_owner is null or c.owner_ids @> array[p_owner])
    and (p_vote  is null or c.vote = p_vote);
$$;
