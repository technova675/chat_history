-- Per-owner, per-account post rollup for /network.
--
-- user_posts_summary answers "what does this account's timeline look like",
-- one row per author, with no notion of whose graph the account sits in.
-- /network needs the same numbers sliced by owner AND by direction, so this
-- view carries the follow-graph edge alongside the rollup: one row per
-- (owner_id, rest_id), with the relation the pills are defined by.
--
-- A view, not a table: user_posts is upserted continuously by the scrape
-- loop, and a materialised copy would show stale zeroes for every account
-- scraped since the last refresh.
--
-- Requires: follow_graph.sql, user_posts.sql.
-- Run in the Supabase SQL editor. Safe to re-run.

drop view if exists network_posts_summary cascade;

create or replace view network_posts_summary as
with edges as (
  -- One row per (owner, account, direction). The two tables are read
  -- separately because a mutual genuinely has a row in each; the union
  -- collapses to one row per pair in `graph` below.
  select owner_id, rest_id, screen_name, name, description, avatar_url,
         followers, following, tweets, protected, fetched_at,
         true  as is_follower,
         false as is_following
  from followers
  union all
  select owner_id, rest_id, screen_name, name, description, avatar_url,
         followers, following, tweets, protected, fetched_at,
         false, true
  from following
),
graph as (
  -- One row per (owner, account). Freshest edge wins for the profile
  -- columns - the same rule buildGraph applies in TypeScript when a mutual's
  -- two copies, scraped seconds apart, disagree.
  select
    owner_id,
    rest_id,
    (array_agg(screen_name order by fetched_at desc))[1] as screen_name,
    (array_agg(name        order by fetched_at desc))[1] as name,
    (array_agg(description order by fetched_at desc))[1] as description,
    (array_agg(avatar_url  order by fetched_at desc))[1] as avatar_url,
    (array_agg(followers   order by fetched_at desc))[1] as followers,
    (array_agg(following   order by fetched_at desc))[1] as following,
    (array_agg(tweets      order by fetched_at desc))[1] as tweets,
    coalesce(bool_or(protected), false) as protected,
    bool_or(is_follower)  as is_follower,
    bool_or(is_following) as is_following,
    max(fetched_at)       as fetched_at
  from edges
  group by owner_id, rest_id
)
select
  g.owner_id,
  g.rest_id                                   as author_id,
  g.screen_name,
  g.name,
  g.description,
  g.avatar_url,
  g.followers,
  g.following,
  g.tweets,
  g.protected,

  -- Direction membership, and the single label the pills use. Followers and
  -- Following are not disjoint, so both booleans are kept: `relation` is a
  -- convenience for filtering, not a replacement for them.
  g.is_follower,
  g.is_following,
  case
    when g.is_follower and g.is_following then 'mutual'
    when g.is_follower                    then 'non_mutual'
    else                                       'following'
  end as relation,

  -- Post rollup, identical in definition to user_posts_summary. Null - not
  -- zero - for an account whose tweets have not been scraped yet.
  s.posts,
  s.replies,
  s.with_media,
  s.total_likes,
  s.total_views,
  s.avg_likes,
  s.avg_views,
  s.first_post_at,
  s.last_post_at,

  -- True when this account is still owed an actor run.
  (s.posts is null) as needs_scrape
from graph g
left join user_posts_summary s on s.author_id = g.rest_id
where g.screen_name is not null;

comment on view network_posts_summary is
  'One row per (owner_id, account) in the follow graph, with the direction '
  'relation and the user_posts rollup joined on. Backs /network cards and the '
  'network scrape queue.';
