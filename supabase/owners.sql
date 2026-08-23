-- Archive owners: one row per X account whose DM export has been loaded.
-- dm_threads.owner_id / dm_messages.owner_id will reference this table.
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists owners (
  owner_id           text primary key,
  screen_name        text not null,
  name               text,
  avatar_url         text,
  banner_url         text,
  description        text,
  followers          integer,
  following          integer,
  is_blue_verified   boolean default false,
  account_created_at timestamptz,
  raw                jsonb,
  added_at           timestamptz not null default now()
);

comment on table owners is
  'X accounts whose DM archive has been imported. The owner of a thread is the
   side that exported it; the other side is dm_threads.counterparty_id.';

alter table owners enable row level security;

insert into owners (
  owner_id, screen_name, name, avatar_url, banner_url, description,
  followers, following, is_blue_verified, account_created_at
) values
  (
    '958230722292064256',
    'Sim_Onchain',
    'Sim 💫',
    'https://pbs.twimg.com/profile_images/1896409112767791104/PT56bKK7_normal.jpg',
    'https://pbs.twimg.com/profile_banners/958230722292064256/1763293870',
    'You don''t get 1M users by being liked',
    1130,
    566,
    true,
    '2018-01-30T06:49:42Z'
  ),
  (
    '3018488785',
    'Thevirofficial',
    'Vir',
    'https://pbs.twimg.com/profile_images/1742863381219209216/Nv4QQ_M0_normal.jpg',
    'https://pbs.twimg.com/profile_banners/3018488785/1783444111',
    'i make launch videos & founder content for startups

Working with YC backed & SF based founders',
    969,
    381,
    true,
    '2015-02-13T13:02:39Z'
  )
on conflict (owner_id) do update set
  screen_name        = excluded.screen_name,
  name               = excluded.name,
  avatar_url         = excluded.avatar_url,
  banner_url         = excluded.banner_url,
  description        = excluded.description,
  followers          = excluded.followers,
  following          = excluded.following,
  is_blue_verified   = excluded.is_blue_verified,
  account_created_at = excluded.account_created_at;
