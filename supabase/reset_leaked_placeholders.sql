-- Remove follower-scraper data from user_info.
--
-- user_info is DM data: profiles fetched with the premium-twitter-user-scraper
-- actor, which reports the blue badge and DM permission. A repair step during
-- the follow-graph import wrote premium-x-follower-scraper profiles into it
-- instead, which is a different actor with a different payload and neither of
-- those fields.
--
-- The two payloads are told apart by shape, with no id list to keep in sync:
-- the DM actor nests everything under `core`, the follower actor returns a
-- legacy user object with `id_str` at the top level. Every row matching
-- `raw ? 'id_str'` was written by the wrong actor and is reset to the
-- not_found placeholder that load_user_info.py uses for an id the DM actor
-- could not return.
--
-- These accounts are all genuine DM counterparties, so their rows stay - only
-- the borrowed profile data goes. They drop out of user_cards (and so out of
-- /users) until a DM-side re-scrape fills them in, because user_cards requires
-- a non-null screen_name. That is the intended outcome: no profile is honest
-- here, an absent one is.
--
-- Their follow-graph profile is untouched and still lives in social_accounts,
-- where it belongs.
--
-- Expected: 62 rows updated, user_cards 541 -> 482.
-- Run the WHOLE file in the Supabase SQL editor. Safe to re-run - a second run
-- matches nothing, because the reset clears `raw`.

begin;

-- Look before overwriting.
select
  count(*)                                                as to_reset,
  count(*) filter (where u.screen_name is not null)        as currently_named,
  count(*) filter (where u.fetch_status = 'ok')            as currently_ok
from user_info u
where u.raw ? 'id_str';

update user_info u set
  screen_name                 = null,
  name                        = null,
  description                 = null,
  location                    = null,
  website                     = null,
  account_created_at          = null,
  followers                   = null,
  following                   = null,
  tweets                      = null,
  media_tweets                = null,
  favorites_count             = null,
  creator_subscriptions_count = null,
  is_blue_verified            = null,
  verified                    = null,
  protected                   = null,
  suspended                   = null,
  can_dm                      = null,
  avatar_url                  = null,
  banner_url                  = null,
  raw                         = null,
  fetch_status                = 'not_found',
  fetched_at                  = now()
where u.raw ? 'id_str';

commit;

-- Should be 0: nothing written by the follower actor is left in the DM table.
select count(*) as follower_payloads_left from user_info where raw ? 'id_str';

-- Should be 482.
select count(*) as user_cards_rows from user_cards;
