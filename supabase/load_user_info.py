"""Load an Apify premium-twitter-user-scraper dataset export into user_info.

Mirrors the toRow() mapping in app/api/scrape/route.ts, so profiles imported
from a downloaded dataset file are shaped identically to ones the /scrape page
buys itself. Ids that were requested but absent from the dataset are written as
fetch_status = 'not_found', which is what keeps them from being re-bought.

  python supabase/load_user_info.py --dataset path/to/dataset.json \
      [--requested user_missing.txt] [--dry-run]
"""
import argparse, json, os, sys, urllib.request, urllib.error
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".env.local")
BATCH    = 500


def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def twitter_date(value):
    """'Sun Jun 12 15:57:35 +0000 2022' -> ISO, or None if unparseable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return parsedate_to_datetime(value).isoformat()
    except (TypeError, ValueError):
        return None


def to_row(u, now):
    g = lambda k: u.get(k) or {}
    return {
        "rest_id":                     str(u["rest_id"]),
        "screen_name":                 g("core").get("screen_name"),
        "name":                        g("core").get("name"),
        "description":                 g("profile_bio").get("description"),
        "location":                    g("location").get("location"),
        "website":                     g("website").get("url") or None,
        "account_created_at":          twitter_date(g("core").get("created_at")),
        "followers":                   g("relationship_counts").get("followers"),
        "following":                   g("relationship_counts").get("following"),
        "tweets":                      g("tweet_counts").get("tweets"),
        "media_tweets":                g("tweet_counts").get("media_tweets"),
        "favorites_count":             g("action_counts").get("favorites_count"),
        "creator_subscriptions_count": u.get("creator_subscriptions_count"),
        "is_blue_verified":            g("verification").get("is_blue_verified"),
        "verified":                    g("verification").get("verified"),
        "protected":                   g("privacy").get("protected"),
        "suspended":                   g("privacy").get("suspended"),
        "can_dm":                      g("dm_permissions").get("can_dm"),
        "avatar_url":                  g("avatar").get("image_url"),
        "banner_url":                  g("banner").get("image_url"),
        "fetch_status":                "ok",
        "raw":                         u,
        "fetched_at":                  now,
    }


def upsert(base_url, key, table, rows, conflict):
    url = f"{base_url}/rest/v1/{table}?on_conflict={conflict}"
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        req = urllib.request.Request(
            url,
            data=json.dumps(chunk).encode("utf-8"),
            method="POST",
            headers={
                "apikey":        key,
                "Authorization": f"Bearer {key}",
                "Content-Type":  "application/json",
                "Prefer":        "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            sys.exit(f"\n{table} batch at row {i} failed: {e.code} {e.read().decode(errors='replace')}")
        sent += len(chunk)
        print(f"  {table}: {sent}/{len(rows)}", end="\r", flush=True)
    print(f"  {table}: {sent}/{len(rows)} done")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset",   required=True, help="Apify dataset JSON export")
    ap.add_argument("--requested", help="ids submitted to the actor, one per line; "
                                        "any not in the dataset are marked not_found")
    ap.add_argument("--dry-run",   action="store_true")
    args = ap.parse_args()

    env = load_env(ENV_FILE)
    base = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key  = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local")

    with open(args.dataset, encoding="utf-8") as fh:
        items = json.load(fh)
    if not isinstance(items, list):
        sys.exit("dataset must be a JSON array of profiles")

    now  = datetime.now(timezone.utc).isoformat()
    rows, seen = [], set()
    for u in items:
        rid = str(u.get("rest_id") or "")
        if not rid or rid in seen:      # last write wins on dupes within a file
            continue
        seen.add(rid)
        rows.append(to_row(u, now))

    missing = []
    if args.requested:
        with open(args.requested, encoding="utf-8") as fh:
            requested = [l.strip() for l in fh if l.strip()]
        missing = [i for i in dict.fromkeys(requested) if i not in seen]
        # PostgREST rejects a batch whose objects have differing key sets, so
        # not_found rows carry every column, explicitly null.
        blank = {k: None for k in to_row({"rest_id": ""}, now)}
        for i in missing:
            rows.append({**blank, "rest_id": i,
                         "fetch_status": "not_found", "fetched_at": now})

    print(f"{len(items)} dataset items -> {len(seen)} unique profiles"
          + (f", {len(missing)} requested ids not returned (not_found)" if args.requested else ""))

    if args.dry_run:
        print("dry run - nothing uploaded")
        return

    print("uploading")
    upsert(base, key, "user_info", rows, "rest_id")
    print("done")


if __name__ == "__main__":
    main()
