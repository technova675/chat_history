-- The follow graph, in one independent table.
--
-- This is NOT DM data and shares nothing with it. user_info holds accounts
-- that appear in a DM archive, fetched with the premium-twitter-user-scraper
-- actor, which reports the blue badge and DM permission. This table holds the
-- premium-x-follower-scraper output, a legacy user object with neither, for a
-- thousand accounts nobody has ever DMed. An account that is in both simply
-- has a row in each, and neither import can ever touch the other's row.
--
-- One row per (owner, account). The Apify export lists a mutual twice - once
-- tagged follower, once following - which is how a two-value field encodes
-- three states. Here `relation` carries the third state directly, so the
-- second copy has nothing left to say and the 1,329 exported items become
-- 1,147 rows: 765 follower + 200 following + 182 mutual.
--
-- Requires: owners.sql, user_posts.sql, user_votes.
-- Run the WHOLE file in the Supabase SQL editor. Safe to re-run: the table is
-- created only if absent, so re-running rebuilds the view and function without
-- touching a single imported row.

-- The two-table shape this replaces, and the view built on it.
drop view  if exists social_cards cascade;
drop table if exists social_profiles cascade;
drop table if exists social_graph    cascade;
-- Dropped, not replaced: the returned columns change.
drop function if exists social_card_totals(text, text);

create table if not exists social_accounts (
  owner_id           text not null references owners (owner_id) on delete cascade,
  rest_id            text not null,

  -- follower  = follows the owner, not followed back
  -- following = the owner follows them, they do not follow back
  -- mutual    = both directions
  relation           text not null,
  -- Derived, never written: one fact, stored once. Lets a query ask for
  -- mutual/non-mutual without knowing the relation vocabulary.
  mutual             boolean generated always as (relation = 'mutual') stored,

  screen_name        text,
  name               text,
  description        text,
  location           text,
  website            text,
  account_created_at timestamptz,

  followers          integer,
  following          integer,
  tweets             integer,
  media_tweets       integer,
  favorites_count    integer,

  -- The legacy blue check, which is not user_info.is_blue_verified and is
  -- false on essentially every account now.
  verified           boolean,
  protected          boolean,

  avatar_url         text,
  banner_url         text,

  raw                jsonb,
  fetched_at         timestamptz not null default now(),

  constraint social_accounts_pkey primary key (owner_id, rest_id),
  constraint social_accounts_relation_valid
    check (relation in ('follower', 'following', 'mutual'))
);

comment on table social_accounts is
  'The scraped X follow graph, one row per (owner, account). Independent of
   user_info: different actor, different fields, and a follower import must
   never write to the DM tables.';

create index if not exists social_accounts_owner_idx
  on social_accounts (owner_id);
create index if not exists social_accounts_relation_idx
  on social_accounts (owner_id, relation);
create index if not exists social_accounts_rest_id_idx
  on social_accounts (rest_id);
create index if not exists social_accounts_followers_idx
  on social_accounts (followers desc nulls last);

alter table social_accounts enable row level security;

-- One row per account, shaped like user_cards so the same card renders it.
-- The grouping matters once a second owner is imported: someone in both
-- graphs has two rows here and must still be a single card.
create view social_cards as
select
  a.rest_id,

  -- Profile fields belong to the account, not to the edge, so with two owners
  -- there are two copies of them, scraped at different times. Take the
  -- freshest rather than an arbitrary one.
  (array_agg(a.screen_name  order by a.fetched_at desc))[1] as screen_name,
  (array_agg(a.name         order by a.fetched_at desc))[1] as name,
  (array_agg(a.description  order by a.fetched_at desc))[1] as description,
  (array_agg(a.location     order by a.fetched_at desc))[1] as location,
  (array_agg(a.followers    order by a.fetched_at desc))[1] as followers,
  (array_agg(a.following    order by a.fetched_at desc))[1] as following,
  (array_agg(a.tweets       order by a.fetched_at desc))[1] as tweets,
  (array_agg(a.avatar_url   order by a.fetched_at desc))[1] as avatar_url,

  -- Held so the card renders from one row shape whichever feed it is in. This
  -- actor reports neither, so both are always null and the card draws no
  -- badge and no DMs-open pill rather than a false one.
  null::boolean as is_blue_verified,
  null::boolean as can_dm,

  bool_or(a.protected) as protected,
  bool_or(a.mutual)    as mutual,

  array_agg(distinct a.owner_id) as owner_ids,
  array_agg(distinct a.relation) as relations,

  -- Owner and direction have to be testable as one pair: an account can
  -- follow owner A while being followed by owner B, and testing the two
  -- arrays separately would match a combination it never had. A mutual counts
  -- as both directions, which is what keeps the Followers and Following pills
  -- summing to more than the All pill.
  array_agg(distinct a.owner_id) filter
    (where a.relation in ('follower',  'mutual')) as follower_owner_ids,
  array_agg(distinct a.owner_id) filter
    (where a.relation in ('following', 'mutual')) as following_owner_ids,
  -- Both directions at once. Not a slice of the two above: it is the
  -- intersection they overlap on, and the Mutual pill filters on it alone.
  array_agg(distinct a.owner_id) filter
    (where a.relation = 'mutual') as mutual_owner_ids,
  -- One direction only. Its own array rather than "not in mutual_owner_ids":
  -- across two owners an account can be a mutual of one and a one-way follower
  -- of the other, and it belongs under both pills.
  array_agg(distinct a.owner_id) filter
    (where a.relation <> 'mutual') as non_mutual_owner_ids,

  -- Post rollup and vote are per-account features that sit above either
  -- source, so they join here the way they do on user_cards.
  max(s.posts)       as posts,
  max(s.total_views) as total_views,
  max(s.avg_views)   as avg_views,

  coalesce(max(
    case when v.liked then 'like' when v.disliked then 'dislike' end
  ), 'none') as vote

from social_accounts a
left join user_posts_summary s on s.author_id = a.rest_id
left join user_votes v         on v.user_id   = a.rest_id
where a.screen_name is not null
group by a.rest_id;

comment on view social_cards is
  'Feed behind /network. Page it with limit/offset ordered by followers desc.
   Followers pill: relations overlaps {follower,mutual}, or for one owner
   follower_owner_ids contains that owner. Following pill: the same with
   following_owner_ids. Mutual and Non-mutual pills: mutual_owner_ids and
   non_mutual_owner_ids.';

-- Header totals for /network. A function for the same reason user_card_totals
-- is one: PostgREST can count rows but cannot sum a column.
--
-- Verified and DMs-open are deliberately not reported: this source carries
-- neither, and a zero would read as a fact rather than as an absence. Mutuals
-- and protected accounts are things it does know.
create or replace function social_card_totals(
  p_owner    text default null,
  p_relation text default null
)
returns table (
  profiles       bigint,
  mutual         bigint,
  protected      bigint,
  combined_reach bigint
)
language sql
stable
as $$
  select
    count(*)                              as profiles,
    count(*) filter (where c.mutual)      as mutual,
    count(*) filter (where c.protected)   as protected,
    coalesce(sum(c.followers), 0)::bigint as combined_reach
  from social_cards c
  where case
    -- Every owner, both directions.
    when p_owner is null and p_relation is null then true
    -- One direction, every owner. A mutual satisfies either direction.
    when p_owner is null then
      c.relations && (case p_relation
        when 'follower'   then array['follower',  'mutual']
        when 'following'  then array['following', 'mutual']
        -- Non-mutual is not the complement of mutual once two owners are
        -- loaded: an account can be one-way to one and mutual to the other.
        when 'non_mutual' then array['follower',  'following']
        else array[p_relation] end)
    -- One owner, both directions.
    when p_relation is null then c.owner_ids @> array[p_owner]
    -- One owner, one direction. Mutual is its own case rather than the
    -- overlap of the other two, so the pill counts what it says it counts.
    when p_relation = 'follower'  then c.follower_owner_ids  @> array[p_owner]
    when p_relation = 'following' then c.following_owner_ids @> array[p_owner]
    when p_relation = 'mutual'    then c.mutual_owner_ids    @> array[p_owner]
    when p_relation = 'non_mutual'
      then c.non_mutual_owner_ids @> array[p_owner]
    else false
  end;
$$;
