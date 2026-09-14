"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Candidate = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
};

type Queue = {
  ownerId: string;
  total: number;
  done: number;
  remaining: number;
  maxItems: number;
  pending: Candidate[];
};

type RunResult = {
  screenName: string;
  returned: number;
  imported: number;
  skipped: number;
  duplicates: number;
  elapsedMs: number;
  error?: string;
};

type LogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };

/** 1.2K / 3.4M, matching the card formatting. */
function compact(n: number | null): string {
  if (n === null) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

export default function NetworkScrapePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(0);
  const [emptyRuns, setEmptyRuns] = useState(0);
  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Handles finished this session. The queue only drops a handle once a row
  // lands, so an account with no posts in the window would otherwise be run
  // again on every pass - this is what keeps the loop moving past them.
  const attempted = useRef(new Set<string>());

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [...prev, { text, tone }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/network/scrape");
    const data = await res.json();
    if (data.error) setError(data.error);
    else setQueue(data);
    return data as Queue;
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  /** One handle: one billable actor run. Returns false to stop the loop. */
  const runOne = useCallback(
    async (handle: Candidate, index: number, total: number) => {
      const res = await fetch("/api/network/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenName: handle.screen_name }),
      });
      const data: RunResult = await res.json();
      attempted.current.add(handle.screen_name.toLowerCase());

      const secs = (data.elapsedMs / 1000).toFixed(1);
      const prefix = `${index}/${total} @${handle.screen_name}`;

      if (data.error) {
        say(`${prefix} — ${data.error} · ${secs}s`, "error");
        return;
      }

      setImported((n) => n + data.imported);

      if (data.imported === 0) {
        // Nothing to upsert, so this handle stays in the queue. Worth seeing:
        // it is a paid run that bought no rows.
        setEmptyRuns((n) => n + 1);
        say(`${prefix} — no posts in window · ${secs}s`, "warn");
        return;
      }

      say(
        `${prefix} — ${data.imported} post(s) stored` +
          (data.skipped ? ` · ${data.skipped} skipped` : "") +
          (data.duplicates ? ` · ${data.duplicates} dupe(s)` : "") +
          ` · ${secs}s`,
        "ok"
      );
    },
    [say]
  );

  const start = useCallback(
    async (all: boolean) => {
      setRunning(true);
      setError(null);
      stopRef.current = false;

      try {
        const fresh = await refresh();
        const pending = fresh.pending.filter(
          (p) => !attempted.current.has(p.screen_name.toLowerCase())
        );

        if (pending.length === 0) {
          say("nothing left to scrape.", "ok");
          return;
        }

        const batch = all ? pending : pending.slice(0, 1);
        say(
          `${batch.length} handle(s) · ${fresh.maxItems} post(s) each · ` +
            `owner ${fresh.ownerId}`
        );

        // Sequential on purpose: the Apify plan is FREE, which limits
        // concurrent actor runs. Parallel handles would start erroring.
        for (const [i, handle] of batch.entries()) {
          if (stopRef.current) {
            say("stopped — finished handles are already stored", "info");
            break;
          }
          await runOne(handle, i + 1, batch.length);
        }

        await refresh();
      } catch (e) {
        say(String(e), "error");
        setError(String(e));
      } finally {
        setRunning(false);
      }
    },
    [refresh, runOne, say]
  );

  const pct =
    queue && queue.total > 0 ? Math.round((queue.done / queue.total) * 100) : 0;

  // Pay-per-result: one result is one post, so the ceiling is handles x
  // maxItems. Accounts with a thin timeline cost less than this.
  const cost = queue
    ? ((queue.remaining * queue.maxItems * 0.00025).toFixed(2))
    : "0.00";

  const next = queue?.pending.slice(0, 12) ?? [];

  return (
    <main className="min-h-screen bg-[#0b0f14] px-6 py-10 font-mono text-[13px] text-slate-300">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] text-slate-100">network post scrape</h1>
          <a
            href="/network"
            className="text-slate-500 transition-colors hover:text-slate-300"
          >
            ← back to /network
          </a>
        </div>

        <p className="leading-relaxed text-slate-400">
          Latest {queue?.maxItems ?? 20} posts for every{" "}
          <span className="text-emerald-400">non-mutual follower</span> of owner{" "}
          <span className="text-slate-200">{queue?.ownerId ?? "…"}</span> —
          accounts in <span className="text-slate-200">followers</span> but not{" "}
          <span className="text-slate-200">following</span>, skipping protected
          profiles and any handle already in{" "}
          <span className="text-slate-200">user_posts</span>. One synchronous
          actor run per handle. Billed per result — up to about ${cost} for the{" "}
          {queue?.remaining ?? 0} handle(s) left.
        </p>

        <div className="rounded border border-sky-900/60 bg-sky-950/20 px-5 py-4 leading-relaxed text-sky-300">
          Keep this tab open — the loop runs in the browser and stops if the page
          is closed. Stopping is safe: finished handles are already stored, and a
          re-run skips them. Rows land in{" "}
          <span className="text-sky-200">user_posts</span>; the{" "}
          <span className="text-sky-200">user_posts_summary</span> and{" "}
          <span className="text-sky-200">network_posts_summary</span> rollups —
          posts, total views, median views — recompute on the next page load.
        </div>

        <div className="relative h-7 w-full overflow-hidden rounded-full border border-slate-700/70 bg-[#111823]">
          <div
            className="absolute inset-y-0 left-0 bg-emerald-800/70 transition-[width] duration-500"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
          <div className="relative flex h-full items-center justify-center gap-2 text-[12px] text-slate-200">
            <span>
              {queue?.done ?? 0} / {queue?.total ?? 0} handles
            </span>
            <span className="text-slate-500">·</span>
            <span>{imported} posts stored</span>
            <span className="text-slate-500">·</span>
            <span>{emptyRuns} empty</span>
            <span className="text-slate-500">·</span>
            <span>{pct}%</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => start(true)}
            disabled={running || queue?.remaining === 0}
            className="rounded border border-emerald-700/70 bg-emerald-900/30 px-4 py-2 text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "running…" : "run all remaining"}
          </button>

          <button
            onClick={() => start(false)}
            disabled={running || queue?.remaining === 0}
            className="rounded border border-slate-700 px-4 py-2 text-slate-300 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            run one handle
          </button>

          {running && (
            <button
              onClick={() => {
                stopRef.current = true;
              }}
              className="rounded border border-red-800/70 px-4 py-2 text-red-400 transition-colors hover:bg-red-950/40"
            >
              stop after this handle
            </button>
          )}

          <span className="ml-auto text-slate-500">
            {queue?.remaining ?? 0} left
          </span>
        </div>

        {error && (
          <p className="rounded border border-red-900/70 bg-red-950/30 px-4 py-3 text-red-400">
            {error}
          </p>
        )}

        {next.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {next.map((c) => (
              <span
                key={c.rest_id}
                className="rounded-full border border-slate-800 bg-[#0d1219] px-2.5 py-1 text-[11px] text-slate-400"
              >
                @{c.screen_name}
                <span className="ml-1.5 text-slate-600">
                  {compact(c.followers)}
                </span>
              </span>
            ))}
            {(queue?.remaining ?? 0) > next.length && (
              <span className="px-1 py-1 text-[11px] text-slate-600">
                +{(queue?.remaining ?? 0) - next.length} more
              </span>
            )}
          </div>
        )}

        <div className="h-[420px] overflow-y-auto rounded border border-slate-800 bg-[#0d1219] p-4 leading-[1.9]">
          {log.length === 0 ? (
            <p className="text-slate-600">
              idle — nothing scraped yet this session.
            </p>
          ) : (
            log.map((line, i) => (
              <div
                key={i}
                className={
                  line.tone === "error"
                    ? "text-red-400"
                    : line.tone === "warn"
                      ? "text-amber-400"
                      : line.tone === "ok"
                        ? "text-emerald-400"
                        : "text-slate-400"
                }
              >
                {line.text}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </main>
  );
}
