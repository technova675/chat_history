-- X profile data scraped via Apify actor
-- kaitoeasyapi/premium-twitter-user-scraper-pay-per-result
-- Run in the Supabase SQL editor. Safe to re-run.

drop table if exists user_info cascade;

create table user_info (
  id                 uuid primary key default gen_random_uuid(),
  rest_id            text not null unique,

  -- core identity
  screen_name        text,
  name               text,
  description        text,
  location           text,
  website            text,
  account_created_at timestamptz,

  -- counts
  followers          integer,
  following          integer,
  tweets             integer,
  media_tweets       integer,
  favorites_count    integer,
  creator_subscriptions_count integer,

  -- flags
  is_blue_verified   boolean,
  verified           boolean,
  protected          boolean,
  suspended          boolean,
  can_dm             boolean,

  -- media
  avatar_url         text,
  banner_url         text,

  -- provenance
  fetch_status       text not null default 'ok',
  raw                jsonb,
  fetched_at         timestamptz not null default now(),

  constraint fetch_status_valid check (fetch_status in ('ok', 'not_found'))
);

comment on column user_info.fetch_status is
  'ok = actor returned a profile; not_found = id was submitted but returned nothing (deleted/suspended/invalid). Ids absent from this table have not been fetched yet.';

create index user_info_screen_name_idx  on user_info (lower(screen_name));
create index user_info_followers_idx    on user_info (followers desc nulls last);
create index user_info_can_dm_idx       on user_info (can_dm);
create index user_info_verified_idx     on user_info (is_blue_verified);
create index user_info_status_idx       on user_info (fetch_status);

alter table user_info enable row level security;

-- Progress helper: how much of the 1,696-id list is done.
create or replace view user_info_progress as
select
  count(*)                                          as fetched,
  count(*) filter (where fetch_status = 'ok')       as ok,
  count(*) filter (where fetch_status = 'not_found') as not_found,
  max(fetched_at)                                   as last_fetched_at
from user_info;

-- The payoff join: profile data against DM reply behaviour.
create or replace view dm_threads_enriched as
select
  t.*,
  u.screen_name,
  u.name,
  u.followers,
  u.following,
  u.tweets,
  u.is_blue_verified,
  u.can_dm,
  u.description
from dm_threads t
left join user_info u on u.rest_id = t.counterparty_id;
