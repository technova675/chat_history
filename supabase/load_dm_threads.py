"""Load replied DM threads from an X archive into Supabase.

Reads a direct-messages.js export, keeps every conversation containing at least
one inbound message, and upserts dm_threads + dm_messages via PostgREST.
Run supabase/schema.sql, owners.sql and add_owner_id.sql first, and make sure
the owner already has a row in `owners` (the FK requires it).

  python supabase/load_dm_threads.py --owner 3018488785 \
      --archive D:/PROJECTS/X_CHAT/VIR/data/direct-messages.js [--dry-run]

Defaults to the Sim_Onchain export at ../data/direct-messages.js.
"""
import argparse, json, os, sys, urllib.request, urllib.error
from datetime import datetime

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".env.local")
DEFAULT_OWNER   = "958230722292064256"
DEFAULT_ARCHIVE = os.path.join(os.path.dirname(ROOT), "data", "direct-messages.js")
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


def bucket(inbound):
    return f"exactly_{inbound}" if 1 <= inbound <= 5 else "long_conversation"


def parse_archive(path, me):
    """me is the owner's numeric X id; is_from_me / initiated_by_me are relative to it."""
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    data = json.loads(raw[raw.index("["):])

    threads, messages = [], []
    for convo in data:
        d  = convo["dmConversation"]
        ms = [m["messageCreate"] for m in d["messages"] if "messageCreate" in m]
        if not ms:
            continue
        inbound = [m for m in ms if m["senderId"] != me]
        if not inbound:
            continue                      # no reply -> not a thread we care about

        ms.sort(key=lambda m: m["createdAt"])
        cid   = d["conversationId"]
        other = next((p for p in cid.split("-") if p != me), None)
        first = datetime.fromisoformat(ms[0]["createdAt"].replace("Z", "+00:00"))
        last  = datetime.fromisoformat(ms[-1]["createdAt"].replace("Z", "+00:00"))

        threads.append({
            "owner_id":         me,
            "conversation_id":  cid,
            "counterparty_id":  other or "",
            "initiated_by_me":  ms[0]["senderId"] == me,
            "inbound_count":    len(inbound),
            "outbound_count":   len(ms) - len(inbound),
            "message_count":    len(ms),
            "reply_bucket":     bucket(len(inbound)),
            "first_message_at": ms[0]["createdAt"],
            "last_message_at":  ms[-1]["createdAt"],
            "span_days":        (last - first).days,
            "opening_text":     ms[0].get("text"),
        })
        for seq, m in enumerate(ms):
            messages.append({
                "owner_id":        me,
                "message_id":      m["id"],
                "conversation_id": cid,
                "sender_id":       m["senderId"],
                "recipient_id":    m.get("recipientId"),
                "is_from_me":      m["senderId"] == me,
                "seq":             seq,
                "body":            m.get("text"),
                "created_at":      m["createdAt"],
                "url_count":       len(m.get("urls", [])),
                "media_count":     len(m.get("mediaUrls", [])),
            })
    return threads, messages


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
    ap.add_argument("--owner",   default=DEFAULT_OWNER,   help="owner's numeric X id (must exist in owners)")
    ap.add_argument("--archive", default=DEFAULT_ARCHIVE, help="path to direct-messages.js")
    ap.add_argument("--dry-run", action="store_true",     help="parse and report, upload nothing")
    args = ap.parse_args()

    env = load_env(ENV_FILE)
    base = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key  = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local")

    print(f"owner {args.owner}")
    print(f"parsing {args.archive}")
    threads, messages = parse_archive(args.archive, args.owner)

    dist = {}
    for t in threads:
        dist[t["reply_bucket"]] = dist.get(t["reply_bucket"], 0) + 1
    print(f"{len(threads)} threads, {len(messages)} messages")
    for b in ["exactly_1", "exactly_2", "exactly_3", "exactly_4", "exactly_5", "long_conversation"]:
        print(f"  {b:<18} {dist.get(b, 0)}")

    if args.dry_run:
        print("dry run - nothing uploaded")
        return

    print("uploading")
    upsert(base, key, "dm_threads",  threads,  "owner_id,conversation_id")
    upsert(base, key, "dm_messages", messages, "owner_id,message_id")
    print("done")


if __name__ == "__main__":
    main()
