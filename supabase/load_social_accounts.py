"""Load an Apify premium-x-follower-scraper export into social_accounts.

Each item is a legacy Twitter user object carrying the direction it was found
in (type = follower|following) and whose graph it came from (target_username).
A mutual is exported twice, once under each direction; both copies collapse
into one row whose relation is "mutual".

This never writes to user_info. That table is DM data, fetched with a
different actor that reports the blue badge and DM permission; this actor
reports neither, so a shared table would let a follower import quietly
downgrade a DM counterparty row. An account in both has a row in each.

  python supabase/load_social_accounts.py --dataset path/to/dataset.json \n      [--owner <owner_id>] [--dry-run]
"""
import argparse, json, os, sys, urllib.parse, urllib.request, urllib.error
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
    """'Wed Dec 19 21:50:00 +0000 2012' -> ISO, or None if unparseable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return parsedate_to_datetime(value).isoformat()
    except (TypeError, ValueError):
        return None


def website(u):
    """The expanded bio/url link, not the t.co shortener X hands out."""
    entities = u.get("entities") or {}
    for section in ("url", "description"):
        for e in (entities.get(section) or {}).get("urls") or []:
            if e.get("expanded_url"):
                return e["expanded_url"]
    return u.get("url")


def to_row(u, owner_id, relation, now):
    """Legacy user object -> a social_accounts row."""
    return {
        "owner_id":                    owner_id,
        "rest_id":                     str(u["id_str"]),
        "relation":                    relation,
        "screen_name":                 u.get("screen_name"),
        "name":                        u.get("name"),
        "description":                 u.get("description"),
        "location":                    u.get("location") or None,
        "website":                     website(u),
        "account_created_at":          twitter_date(u.get("created_at")),
        "followers":                   u.get("followers_count"),
        "following":                   u.get("friends_count"),
        "tweets":                      u.get("statuses_count"),
        "media_tweets":                u.get("media_count"),
        "favorites_count":             u.get("favourites_count"),
        # No is_blue_verified / can_dm: this actor reports neither, and
        # social_cards surfaces them as null so the card draws no false badge.
        "verified":                    u.get("verified"),
        "protected":                   u.get("protected"),
        "avatar_url":                  u.get("profile_image_url_https"),
        "banner_url":                  u.get("profile_banner_url"),
        "raw":                         u,
        "fetched_at":                  now,
    }


def request(url, key, method="GET", body=None, prefer=None):
    headers = {
        "apikey":        key,
        "Authorization": f"Bearer {key}",
        "Content-Type":  "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"\n{method} {url} failed: {e.code} {e.read().decode(errors='replace')}")


def upsert(base, key, table, rows, conflict):
    url = f"{base}/rest/v1/{table}?on_conflict={conflict}"
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        request(url, key, "POST", chunk,
                "resolution=merge-duplicates,return=minimal")
        sent += len(chunk)
        print(f"  {table}: {sent}/{len(rows)}", end="\r", flush=True)
    print(f"  {table}: {sent}/{len(rows)} done")


def resolve_owner(base, key, screen_name):
    q = urllib.parse.quote(screen_name, safe="")
    rows = request(
        f"{base}/rest/v1/owners?select=owner_id,screen_name&screen_name=ilike.{q}", key
    )
    if not rows:
        sys.exit(f"no owner row for @{screen_name} - add it to owners.sql first, "
                 f"or pass --owner <owner_id>")
    return rows[0]["owner_id"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="Apify dataset JSON export")
    ap.add_argument("--owner", help="owner_id to attach the edges to; default is "
                                    "resolved from each item's target_username")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    env  = load_env(ENV_FILE)
    base = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key  = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
                 "must be set in .env.local")

    with open(args.dataset, encoding="utf-8") as fh:
        items = json.load(fh)
    if not isinstance(items, list):
        sys.exit("dataset must be a JSON array of profiles")

    now     = datetime.now(timezone.utc).isoformat()
    seen    = {}   # (owner_id, rest_id) -> {"item": u, "relations": set()}
    owners  = {}   # target_username -> owner_id, resolved once each
    skipped = 0

    for u in items:
        rid      = str(u.get("id_str") or u.get("id") or "")
        relation = u.get("type")
        target   = u.get("target_username")
        if not rid or relation not in ("follower", "following"):
            skipped += 1
            continue
        if not (args.owner or target):
            skipped += 1
            continue

        if args.owner:
            owner_id = args.owner
        else:
            if target not in owners:
                owners[target] = resolve_owner(base, key, target)
            owner_id = owners[target]

        # Last copy wins on the profile itself: the two exports of a mutual
        # are seconds apart, so the later one is marginally fresher.
        entry = seen.setdefault((owner_id, rid), {"item": u, "relations": set()})
        entry["item"] = u
        entry["relations"].add(relation)

    rows = []
    for (owner_id, rid), entry in seen.items():
        # Both directions present means they follow each other. That is the
        # whole reason the export listed this account twice.
        relation = ("mutual" if len(entry["relations"]) == 2
                    else next(iter(entry["relations"])))
        rows.append(to_row(entry["item"], owner_id, relation, now))

    counts = {}
    for r in rows:
        counts[r["relation"]] = counts.get(r["relation"], 0) + 1

    print(f"{len(items)} items -> {len(rows)} accounts ("
          + ", ".join(f"{v} {k}" for k, v in sorted(counts.items()))
          + ")" + (f", {skipped} items skipped" if skipped else ""))

    if args.dry_run:
        print("dry run - nothing uploaded")
        return

    print("uploading")
    upsert(base, key, "social_accounts", rows, "owner_id,rest_id")
    print("done")


if __name__ == "__main__":
    main()
