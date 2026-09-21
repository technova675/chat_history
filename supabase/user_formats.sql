-- Per-account format vote: which output an account should be approached with.
-- Separate table from user_votes because it answers a different question -
-- like/dislike is one choice, HEYGEN, TEXT and PERSONAL are independent flags
-- and an account can carry all, none, or some of them.
--
-- All default false: no row, or a row with every flag off, means nobody has
-- picked a format yet. RLS on with no policies, like user_votes: the browser never
-- writes here, /api/format does it with the service-role key.
--
-- Run in the Supabase SQL editor, then re-run user_cards.sql so the view picks
-- up the columns. Safe to re-run.

create table if not exists user_formats (
  user_id     text primary key,
  heygen      boolean     not null default false,
  text_format boolean     not null default false,
  personal    boolean     not null default false,
  updated_at  timestamptz not null default now()
);

-- Added after the table shipped, so existing installs pick it up too.
alter table user_formats
  add column if not exists personal boolean not null default false;

alter table user_formats enable row level security;

comment on table user_formats is
  'Format vote behind the HEYGEN / TEXT / PERSONAL buttons on the user card.
   Independent flags, all false until someone toggles one.';
