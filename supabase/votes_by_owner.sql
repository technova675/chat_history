-- Votes and format picks per owner: Vir and Sim each keep their own.
--
-- Until now user_votes and user_formats held one row per account, with no
-- record of who clicked. Each row now carries owner_id, the owner who cast it
-- (picked with the V / S switch at the top of /users and /network), and the
-- key becomes (user_id, owner_id) so both owners can vote on the same account
-- without overwriting each other.
--
-- The rows written before this have no owner and keep owner_id null on
-- purpose: nobody recorded who cast them. They stay in the table but count
-- for neither owner. A unique constraint treats nulls as distinct, so they do
-- not collide with each other or with the new rows.
--
-- Run in the Supabase SQL editor, then re-run user_cards.sql so the view picks
-- up the per-owner columns. Safe to re-run.

alter table user_votes
  add column if not exists owner_id text references owners (owner_id) on delete cascade;
alter table user_formats
  add column if not exists owner_id text references owners (owner_id) on delete cascade;

-- The old key was user_id alone, which allows one vote per account.
alter table user_votes   drop constraint if exists user_votes_pkey;
alter table user_formats drop constraint if exists user_formats_pkey;

alter table user_votes   drop constraint if exists user_votes_user_owner_key;
alter table user_votes
  add constraint user_votes_user_owner_key unique (user_id, owner_id);

alter table user_formats drop constraint if exists user_formats_user_owner_key;
alter table user_formats
  add constraint user_formats_user_owner_key unique (user_id, owner_id);

comment on column user_votes.owner_id is
  'Owner who cast the vote. Null on rows from before votes were per owner.';
comment on column user_formats.owner_id is
  'Owner who picked the formats. Null on rows from before picks were per owner.';
