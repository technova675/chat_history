"""Load replied DM threads from the X archive into Supabase.

Reads data/direct-messages.js, keeps every conversation containing at least one
inbound message, and upserts dm_threads + dm_messages via PostgREST.
Run supabase/schema.sql first.
"""
import json, os, re, sys, urllib.request, urllib.error
from datetime import datetime

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE  = os.path.join(os.path.dirname(ROOT), "data", "direct-messages.js")
ENV_FILE = os.path.join(ROOT, ".env.local")
ME       = "958230722292064256"
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


def parse_archive(path):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    data = json.loads(raw[raw.index("["):])

    threads, messages = [], []
    for convo in data:
        d  = convo["dmConversation"]
        ms = [m["messageCreate"] for m in d["messages"] if "messageCreate" in m]
        if not ms:
            continue
        inbound = [m for m in ms if m["senderId"] != ME]
        if not inbound:
            continue                      # no reply -> not a thread we care about

        ms.sort(key=lambda m: m["createdAt"])
        cid   = d["conversationId"]
        other = next((p for p in cid.split("-") if p != ME), None)
        first = datetime.fromisoformat(ms[0]["createdAt"].replace("Z", "+00:00"))
        last  = datetime.fromisoformat(ms[-1]["createdAt"].replace("Z", "+00:00"))

        threads.append({
            "conversation_id":  cid,
            "counterparty_id":  other or "",
            "initiated_by_me":  ms[0]["senderId"] == ME,
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
                "message_id":      m["id"],
                "conversation_id": cid,
                "sender_id":       m["senderId"],
                "recipient_id":    m.get("recipientId"),
                "is_from_me":      m["senderId"] == ME,
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
    env = load_env(ENV_FILE)
    base = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key  = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        sys.exit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local")

    print(f"parsing {ARCHIVE}")
    threads, messages = parse_archive(ARCHIVE)

    dist = {}
    for t in threads:
        dist[t["reply_bucket"]] = dist.get(t["reply_bucket"], 0) + 1
    print(f"{len(threads)} threads, {len(messages)} messages")
    for b in ["exactly_1", "exactly_2", "exactly_3", "exactly_4", "exactly_5", "long_conversation"]:
        print(f"  {b:<18} {dist.get(b, 0)}")

    print("uploading")
    upsert(base, key, "dm_threads",  threads,  "conversation_id")
    upsert(base, key, "dm_messages", messages, "message_id")
    print("done")


if __name__ == "__main__":
    main()
