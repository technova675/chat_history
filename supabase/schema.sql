-- X DM archive: replied threads + messages
-- Run in Supabase SQL editor. Safe to re-run.

drop table if exists dm_messages cascade;
drop table if exists dm_threads cascade;

create table dm_threads (
  conversation_id   text primary key,
  counterparty_id   text not null,
  initiated_by_me   boolean not null,
  inbound_count     integer not null,
  outbound_count    integer not null,
  message_count     integer not null,
  reply_bucket      text not null,
  first_message_at  timestamptz not null,
  last_message_at   timestamptz not null,
  span_days         integer not null,
  opening_text      text,
  constraint reply_bucket_valid check (reply_bucket in (
    'exactly_1','exactly_2','exactly_3','exactly_4','exactly_5','long_conversation'
  )),
  constraint reply_bucket_matches_count check (
    reply_bucket = case
      when inbound_count between 1 and 5 then 'exactly_' || inbound_count
      else 'long_conversation'
    end
  )
);

create table dm_messages (
  message_id      text primary key,
  conversation_id text not null references dm_threads(conversation_id) on delete cascade,
  sender_id       text not null,
  recipient_id    text,
  is_from_me      boolean not null,
  seq             integer not null,
  body            text,
  created_at      timestamptz not null,
  url_count       integer not null default 0,
  media_count     integer not null default 0
);

create index dm_threads_bucket_idx    on dm_threads (reply_bucket);
create index dm_threads_initiated_idx on dm_threads (initiated_by_me);
create index dm_threads_inbound_idx   on dm_threads (inbound_count desc);
create index dm_threads_first_idx     on dm_threads (first_message_at);
create index dm_messages_convo_idx    on dm_messages (conversation_id, seq);
create index dm_messages_created_idx  on dm_messages (created_at);

alter table dm_threads  enable row level security;
alter table dm_messages enable row level security;

-- Distribution view: the buckets as columns, one row per outreach direction.
create or replace view dm_reply_distribution as
select
  initiated_by_me,
  count(*)                                                          as threads,
  count(*) filter (where reply_bucket = 'exactly_1')                as exactly_1_reply,
  count(*) filter (where reply_bucket = 'exactly_2')                as exactly_2_replies,
  count(*) filter (where reply_bucket = 'exactly_3')                as exactly_3_replies,
  count(*) filter (where reply_bucket = 'exactly_4')                as exactly_4_replies,
  count(*) filter (where reply_bucket = 'exactly_5')                as exactly_5_replies,
  count(*) filter (where reply_bucket = 'long_conversation')        as long_conversation
from dm_threads
group by initiated_by_me;
