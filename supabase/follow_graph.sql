-- The follow graph, as two independent tables: one per direction.
--
-- `followers` holds the accounts that follow an owner. `following` holds the
-- accounts an owner follows. They are separate tables, not one table with a
-- direction column, because that is exactly how the Apify
-- premium-x-follower-scraper exports them (type = follower | following) and a
-- mutual genuinely is two edges: it appears once in each list, and gets a row
-- in each table. Nothing is collapsed on import.
--
-- This is NOT DM data and shares nothing with it. user_info holds accounts
-- that appear in a DM archive, fetched with the premium-twitter-user-scraper
-- actor, which reports the blue badge and DM permission. These two hold the
-- follower-scraper output, a legacy user object with neither. An account in
-- both simply has a row in each, and neither import can touch the other's.
--
-- For the 2026-08-27 export: 1,329 items -> 947 `followers` rows + 382
-- `following` rows, 1,147 distinct accounts, 182 of them in both tables.
--
-- Tables only. No view, no totals function: /network reads whatever is built
-- on top of these later.
--
-- Requires: owners.sql.
-- Run the WHOLE file in the Supabase SQL editor. Safe to re-run: the tables
-- are created only if absent, so re-running touches no imported row.

-- Everything /network used before this file. social_accounts was the
-- one-table-with-a-relation-column shape these two replace; social_profiles
-- and social_graph were the two-table shape it in turn replaced.
drop view     if exists social_cards    cascade;
drop table    if exists social_accounts cascade;
drop table    if exists social_profiles cascade;
drop table    if exists social_graph    cascade;
drop function if exists social_card_totals(text, text);

-- The two tables are deliberately the same shape. A profile is a profile
-- whichever list it turned up in; only membership carries meaning here.

create table if not exists followers (
  owner_id           text not null references owners (owner_id) on delete cascade,
  rest_id            text not null,

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

  constraint followers_pkey primary key (owner_id, rest_id)
);

create table if not exists following (
  owner_id           text not null references owners (owner_id) on delete cascade,
  rest_id            text not null,

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

  verified           boolean,
  protected          boolean,

  avatar_url         text,
  banner_url         text,

  raw                jsonb,
  fetched_at         timestamptz not null default now(),

  constraint following_pkey primary key (owner_id, rest_id)
);

comment on table followers is
  'Accounts that follow an owner, from the export items with type=follower.
   One row per (owner, account). An account that is also followed back has a
   second row in `following`; that pair is what a mutual is.';
comment on table following is
  'Accounts an owner follows, from the export items with type=following.
   One row per (owner, account). Mirror of `followers`.';

create index if not exists followers_owner_idx     on followers (owner_id);
create index if not exists followers_rest_id_idx   on followers (rest_id);
create index if not exists followers_followers_idx on followers (followers desc nulls last);

create index if not exists following_owner_idx     on following (owner_id);
create index if not exists following_rest_id_idx   on following (rest_id);
create index if not exists following_followers_idx on following (followers desc nulls last);

alter table followers enable row level security;
alter table following enable row level security;
