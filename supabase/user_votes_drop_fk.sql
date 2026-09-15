-- Votes have to be castable on accounts that have never been scraped.
--
-- user_votes.user_id carried a foreign key to user_info(rest_id). That held
-- while /users was the only feed: every card there comes from user_info. It
-- broke when /network arrived - that feed is built from the `followers` and
-- `following` edge tables, and most of those accounts have no user_info row
-- yet, so liking one failed with 23503 and /api/vote answered 500.
--
-- The key is dropped rather than the missing profiles backfilled: a vote is a
-- judgement about an account id, and it does not depend on our having scraped
-- that account's profile. user_formats was created without the key for the
-- same reason.
--
-- Run in the Supabase SQL editor. Safe to re-run.

alter table user_votes
  drop constraint if exists user_votes_user_id_fkey;
