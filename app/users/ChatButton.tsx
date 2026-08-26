"use client";

import { useCallback, useEffect, useState } from "react";

type Message = {
  message_id: string;
  is_from_me: boolean;
  body: string | null;
  created_at: string;
  seq: number;
};

type Thread = {
  conversation_id: string;
  initiated_by_me: boolean;
  inbound_count: number;
  outbound_count: number;
  message_count: number;
  reply_bucket: string;
  first_message_at: string;
  last_message_at: string;
  span_days: number;
};

type Props = {
  userId: string;
  screenName: string;
  name: string | null;
  avatarUrl: string | null;
};

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ChatButton({
  userId,
  screenName,
  name,
  avatarUrl,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/thread?userId=${encodeURIComponent(userId)}`
      );
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setThread(data.thread);
        setMessages(data.messages);
      }
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Fetch once, the first time the drawer is opened.
  useEffect(() => {
    if (open && !loaded && !loading) load();
  }, [open, loaded, loading, load]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
      >
        <ChatIcon />
        Chat
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`DM thread with @${screenName}`}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col border-l border-neutral-800 bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-3 border-b border-neutral-800 px-5 py-4">
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-10 w-10 rounded-full bg-neutral-800 object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-neutral-800" />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">
                  {name || screenName}
                </p>
                <p className="truncate font-mono text-xs text-neutral-500">
                  @{screenName}
                </p>
              </div>

              <a
                href={`https://x.com/messages/compose?recipient_id=${userId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                Open on X ↗
              </a>

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg px-2 py-1 text-xl leading-none text-neutral-500 transition-colors hover:text-white"
              >
                ×
              </button>
            </header>

            {thread && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-neutral-800 px-5 py-3 text-[11px] text-neutral-500">
                <span>
                  <span className="text-neutral-300">
                    {thread.message_count}
                  </span>{" "}
                  messages
                </span>
                <span>
                  <span className="text-neutral-300">
                    {thread.inbound_count}
                  </span>{" "}
                  from them
                </span>
                <span>
                  {thread.initiated_by_me ? "You opened" : "They opened"}
                </span>
                <span>
                  {new Date(thread.first_message_at).toLocaleDateString()} —{" "}
                  {new Date(thread.last_message_at).toLocaleDateString()}
                </span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {loading && (
                <p className="text-sm text-neutral-500">Loading thread…</p>
              )}

              {error && (
                <p className="rounded border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-400">
                  {error}
                </p>
              )}

              {!loading && !error && loaded && messages.length === 0 && (
                <p className="text-sm text-neutral-500">
                  No stored thread for this account. Only conversations that got
                  at least one reply were loaded into the database.
                </p>
              )}

              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div
                    key={m.message_id}
                    className={`flex flex-col gap-1 ${
                      m.is_from_me ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        m.is_from_me
                          ? "bg-sky-900/50 text-sky-50"
                          : "bg-neutral-800 text-neutral-200"
                      }`}
                    >
                      {m.body || (
                        <span className="text-neutral-500">(no text)</span>
                      )}
                    </div>
                    <span className="px-1 text-[10px] text-neutral-600">
                      {formatDate(m.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
