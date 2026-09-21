"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Driver for the first-touch sweep: active accounts in the owner's graph with
 * no posts stored at all. One actor run per handle, `from:<handle>`, and only
 * the posts from the keep year are written.
 *
 * Same shape as /network/refill - the loop lives in the browser so each step is
 * one billable run and the tab can be closed between any two of them. Emerald
 * accent is how you tell this tab from the other sweeps at a glance.
 */

type Candidate = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
  tweets: number | null;
};

type Queue = {
  ownerId: string;
  total: number;
  remaining: number;
  maxItems: number;
  keepYear: number;
  followerCeiling: number;
  tweetFloor: number;
  pending: Candidate[];
};

type RunResult = {
  screenName: string;
  returned: number;
  imported: number;
  droppedByYear: number;
  keepYear: number;
  newestPostAt: string | null;
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

export default function NetworkBackfillPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [emptyRuns, setEmptyRuns] = useState(0);
  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Handles finished this session. An account whose whole timeline predates the
  // keep year stores nothing, so it never leaves the server-side queue - this
  // is what keeps the loop moving past it.
  const attempted = useRef(new Set<string>());
  const [done, setDone] = useState(0);

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [...prev, { text, tone }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  // ?owner= on this page is passed straight through to the queue, so the same
  // UI drives any owner's graph.
  const ownerParam = useCallback(() => {
    if (typeof window === "undefined") return "";
    const owner = new URLSearchParams(window.location.search).get("owner");
    return owner ? `?owner=${encodeURIComponent(owner)}` : "";
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/network/backfill${ownerParam()}`);
    const data = await res.json();
    if (data.error) setError(data.error);
    else setQueue(data);
    return data as Queue;
  }, [ownerParam]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  /** One handle: one billable actor run. */
  const runOne = useCallback(
    async (candidate: Candidate, index: number, total: number) => {
      const res = await fetch(`/api/network/backfill${ownerParam()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenName: candidate.screen_name,
          restId: candidate.rest_id,
        }),
      });
      const data: RunResult = await res.json();

      attempted.current.add(candidate.rest_id);
      setDone(attempted.current.size);

      const secs = (data.elapsedMs / 1000).toFixed(1);
      const prefix = `${index}/${total} @${candidate.screen_name}`;

      if (data.error) {
        say(`${prefix} — ${data.error} · ${secs}s`, "error");
        return;
      }

      setStored((n) => n + data.imported);
      setDropped((n) => n + data.droppedByYear);

      if (data.returned === 0) {
        setEmptyRuns((n) => n + 1);
        say(`${prefix} — actor returned nothing · ${secs}s`, "warn");
        return;
      }

      // Everything it had is older than the keep year: a dormant account. The
      // run was still billed, so this is worth seeing rather than silent.
      if (data.imported === 0) {
        const year = data.newestPostAt
          ? new Date(data.newestPostAt).getUTCFullYear()
          : null;
        say(
          `${prefix} — ${data.droppedByYear} post(s) all pre-${data.keepYear}` +
            (year ? `, newest ${year}` : "") +
            ` · nothing stored · ${secs}s`,
          "warn"
        );
        return;
      }

      say(
        `${prefix} — ${data.imported} post(s) stored` +
          (data.droppedByYear
            ? ` · ${data.droppedByYear} dropped (not ${data.keepYear})`
            : "") +
          (data.skipped ? ` · ${data.skipped} skipped` : "") +
          (data.duplicates ? ` · ${data.duplicates} dupe(s)` : "") +
          ` · ${secs}s`,
        "ok"
      );
    },
    [ownerParam, say]
  );

  const start = useCallback(
    async (all: boolean) => {
      setRunning(true);
      setError(null);
      stopRef.current = false;

      try {
        const fresh = await refresh();
        const pending = (fresh.pending ?? []).filter(
          (p) => !attempted.current.has(p.rest_id)
        );

        if (pending.length === 0) {
          say("nothing left to scrape.", "ok");
          return;
        }

        const batch = all ? pending : pending.slice(0, 1);
        say(
          `${batch.length} handle(s) · up to ${fresh.maxItems} post(s) each · ` +
            `keeping ${fresh.keepYear} only · owner ${fresh.ownerId}`
        );

        // Sequential on purpose: the Apify plan is FREE, which limits
        // concurrent actor runs. Parallel handles would start erroring.
        for (const [i, candidate] of batch.entries()) {
          if (stopRef.current) {
            say("stopped — finished handles are already stored", "info");
            break;
          }
          await runOne(candidate, i + 1, batch.length);
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

  // Progress is measured against the queue as it stood when the page loaded: a
  // handle whose posts were all dropped by the year gate leaves the server-side
  // queue unchanged, so the attempted set is the only honest denominator.
  const total = queue?.total ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Pay-per-result: one result is one post, and results dropped by the year
  // gate are billed just the same, so the ceiling is handles x maxItems.
  const left = Math.max((queue?.remaining ?? 0) - done, 0);
  const cost = queue ? (left * queue.maxItems * 0.00025).toFixed(2) : "0.00";

  const next =
    queue?.pending
      .filter((p) => !attempted.current.has(p.rest_id))
      .slice(0, 12) ?? [];

  return (
    <main className="min-h-screen bg-[#0b0f14] px-6 py-10 font-mono text-[13px] text-slate-300">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] text-slate-100">
            post backfill{" "}
            <span className="text-emerald-400">
              · never scraped · {queue?.keepYear ?? 2026} only
            </span>
          </h1>
          <a
            href="/network"
            className="text-slate-500 transition-colors hover:text-slate-300"
          >
            /network
          </a>
          <a
            href="/network/refill"
            className="text-slate-500 transition-colors hover:text-slate-300"
          >
            thin-timeline re-fill
          </a>
        </div>

        <p className="leading-relaxed text-slate-400">
          Accounts in owner{" "}
          <span className="text-slate-200">{queue?.ownerId ?? "…"}</span>&apos;s
          graph with <span className="text-slate-200">no posts stored at all</span>
          , under{" "}
          <span className="text-slate-200">
            {compact(queue?.followerCeiling ?? 100000)}
          </span>{" "}
          followers and more than{" "}
          <span className="text-slate-200">
            {compact(queue?.tweetFloor ?? 500)}
          </span>{" "}
          lifetime tweets, most active first. One actor run per handle with{" "}
          <span className="text-emerald-400">from:@handle</span>. Posts are
          checked before they are written:{" "}
          <span className="text-emerald-400">
            only {queue?.keepYear ?? 2026} posts are saved
          </span>{" "}
          to <span className="text-slate-200">user_posts</span> — older ones are
          fetched, counted, and thrown away. Billed per result — up to about $
          {cost} for the {left} handle(s) left.
        </p>

        <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-5 py-4 leading-relaxed text-emerald-300">
          Keep this tab open — the loop runs in the browser and stops if the page
          is closed. Stopping is safe: finished handles are already stored. Note
          that a dormant account still costs a run — Apify bills per result, and
          the year gate runs after the response, so posts dropped for being
          pre-{queue?.keepYear ?? 2026} are paid for but not kept.
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
              {done} / {total} handles
            </span>
            <span className="text-slate-500">·</span>
            <span>{stored} stored</span>
            <span className="text-slate-500">·</span>
            <span>{dropped} pre-{queue?.keepYear ?? 2026}</span>
            <span className="text-slate-500">·</span>
            <span>{emptyRuns} empty</span>
            <span className="text-slate-500">·</span>
            <span>{pct}%</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => start(true)}
            disabled={running || left === 0}
            className="rounded border border-emerald-700/70 bg-emerald-900/30 px-4 py-2 text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "running…" : "run all remaining"}
          </button>

          <button
            onClick={() => start(false)}
            disabled={running || left === 0}
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

          <span className="ml-auto text-slate-500">{left} left</span>
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
                  {compact(c.tweets)} tweets · {compact(c.followers)}
                </span>
              </span>
            ))}
            {left > next.length && (
              <span className="px-1 py-1 text-[11px] text-slate-600">
                +{left - next.length} more
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
                        ? "text-emerald-300"
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
