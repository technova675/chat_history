-- Per-account format vote: which output an account should be approached with.
-- Separate table from user_votes because it answers a different question -
-- like/dislike is one choice, HEYGEN and TEXT are two independent flags and an
-- account can carry both, neither, or one.
--
-- Both default false: no row, or a row with both off, means nobody has picked
-- a format yet. RLS on with no policies, like user_votes: the browser never
-- writes here, /api/format does it with the service-role key.
--
-- Run in the Supabase SQL editor, then re-run user_cards.sql so the view picks
-- up the two columns. Safe to re-run.

create table if not exists user_formats (
  user_id     text primary key,
  heygen      boolean     not null default false,
  text_format boolean     not null default false,
  updated_at  timestamptz not null default now()
);

alter table user_formats enable row level security;

comment on table user_formats is
  'Format vote behind the HEYGEN / TEXT buttons on the user card. Independent
   flags, both false until someone toggles one.';
