-- Add owner_id to the DM tables so several archives can coexist.
-- Requires owners.sql to have been run first.
-- Run the WHOLE file in the Supabase SQL editor. Safe to re-run.

begin;

-- 1. Add the columns, nullable for now so the backfill can run.
alter table dm_threads  add column if not exists owner_id text;
alter table dm_messages add column if not exists owner_id text;

-- 2. Everything currently loaded came from Sim's export.
update dm_threads  set owner_id = '958230722292064256' where owner_id is null;
update dm_messages set owner_id = '958230722292064256' where owner_id is null;

-- 3. Now that no nulls remain, lock the columns down.
alter table dm_threads  alter column owner_id set not null;
alter table dm_messages alter column owner_id set not null;

-- 4. Foreign keys to owners.
alter table dm_threads  drop constraint if exists dm_threads_owner_id_fkey;
alter table dm_messages drop constraint if exists dm_messages_owner_id_fkey;

alter table dm_threads
  add constraint dm_threads_owner_id_fkey
  foreign key (owner_id) references owners (owner_id) on delete cascade;

alter table dm_messages
  add constraint dm_messages_owner_id_fkey
  foreign key (owner_id) references owners (owner_id) on delete cascade;

-- 5. Composite primary keys.
--    If two owners DMed each other, that one conversation appears in both
--    exports with identical conversation_id and message_id values. Keying on
--    the id alone would collide on the second import.
alter table dm_messages drop constraint if exists dm_messages_conversation_id_fkey;

alter table dm_threads  drop constraint if exists dm_threads_pkey;
alter table dm_messages drop constraint if exists dm_messages_pkey;

alter table dm_threads  add constraint dm_threads_pkey
  primary key (owner_id, conversation_id);
alter table dm_messages add constraint dm_messages_pkey
  primary key (owner_id, message_id);

-- 6. Re-point the message -> thread foreign key at the new composite key.
alter table dm_messages
  add constraint dm_messages_conversation_id_fkey
  foreign key (owner_id, conversation_id)
  references dm_threads (owner_id, conversation_id) on delete cascade;

-- 7. Indexes for the per-owner filtering the UI does.
create index if not exists dm_threads_owner_idx
  on dm_threads (owner_id);
create index if not exists dm_threads_owner_counterparty_idx
  on dm_threads (owner_id, counterparty_id);
create index if not exists dm_messages_owner_idx
  on dm_messages (owner_id);

commit;

-- Views are dropped and recreated rather than replaced: CREATE OR REPLACE VIEW
-- can only append columns, and both of these gain owner columns up front
-- (dm_threads_enriched via t.*, which now includes owner_id).
drop view if exists dm_reply_distribution;
drop view if exists dm_threads_enriched;

-- Distribution view, now split by owner as well as direction.
create view dm_reply_distribution as
select
  t.owner_id,
  o.screen_name as owner_screen_name,
  t.initiated_by_me,
  count(*)                                                     as threads,
  count(*) filter (where t.reply_bucket = 'exactly_1')         as exactly_1_reply,
  count(*) filter (where t.reply_bucket = 'exactly_2')         as exactly_2_replies,
  count(*) filter (where t.reply_bucket = 'exactly_3')         as exactly_3_replies,
  count(*) filter (where t.reply_bucket = 'exactly_4')         as exactly_4_replies,
  count(*) filter (where t.reply_bucket = 'exactly_5')         as exactly_5_replies,
  count(*) filter (where t.reply_bucket = 'long_conversation') as long_conversation
from dm_threads t
join owners o on o.owner_id = t.owner_id
group by t.owner_id, o.screen_name, t.initiated_by_me;

-- Enriched join, carrying the owner through.
create view dm_threads_enriched as
select
  t.*,
  o.screen_name as owner_screen_name,
  o.name        as owner_name,
  o.avatar_url  as owner_avatar_url,
  u.screen_name,
  u.name,
  u.followers,
  u.following,
  u.tweets,
  u.is_blue_verified,
  u.can_dm,
  u.description
from dm_threads t
join owners o on o.owner_id = t.owner_id
left join user_info u on u.rest_id = t.counterparty_id;
