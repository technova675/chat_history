"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SweepOwnerSelect, { useSweepOwner } from "../SweepOwner";
import { shortDate } from "@/lib/format";

/**
 * Driver for the latest-posts sweep: every account the /network cards show
 * for one owner, re-fetched for what it posted since Aug 20. One actor run per
 * handle, `from:<handle>`, sequential.
 *
 * Same shape as /network/refill - the loop lives in the browser so each step
 * is one billable run and the tab can be closed between any two of them. Sky
 * accent is how you tell this tab from the other sweeps at a glance.
 */

type Candidate = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
  posts: number;
  median_views: number | null;
  last_fetched_at: string | null;
};

type Queue = {
  ownerId: string;
  total: number;
  remaining: number;
  fresh: number;
  since: string;
  freshHours: number;
  maxItems: number;
  pending: Candidate[];
};

type RunResult = {
  screenName: string;
  returned: number;
  imported: number;
  skipped: number;
  duplicates: number;
  postsBefore: number | null;
  postsAfter: number | null;
  gained: number | null;
  elapsedMs: number;
  error?: string;
};

type LogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };

/** 1.2K / 3.4M, matching the card formatting. */
function compact(n: number | null): string {
  if (n === null) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

export default function NetworkLatestPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gained, setGained] = useState(0);
  const [emptyRuns, setEmptyRuns] = useState(0);
  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Handles finished this session. An account that posted nothing since Aug 20
  // stores nothing, so its fetch date never moves and the server keeps it in
  // the queue - this is what keeps the loop moving past it.
  const attempted = useRef(new Set<string>());
  const [done, setDone] = useState(0);

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [...prev, { text, tone }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  // Whose graph the queue is drawn from: the dropdown, kept in ?owner= and
  // passed straight through to the API.
  const [owner, setOwner] = useSweepOwner();
  const ownerParam = owner ? `?owner=${encodeURIComponent(owner)}` : "";

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/network/latest${ownerParam}`);
    const data = await res.json();
    if (data.error) setError(data.error);
    else setQueue(data);
    return data as Queue;
  }, [ownerParam]);

  useEffect(() => {
    if (!owner) return;
    refresh().catch((e) => setError(String(e)));
  }, [owner, refresh]);

  // A new owner is a new queue: this session's progress belongs to the old one.
  const changeOwner = useCallback(
    (next: string) => {
      attempted.current.clear();
      setDone(0);
      setGained(0);
      setEmptyRuns(0);
      setQueue(null);
      setError(null);
      setOwner(next);
    },
    [setOwner]
  );

  /** One handle: one billable actor run. */
  const runOne = useCallback(
    async (candidate: Candidate, index: number, total: number) => {
      const res = await fetch(`/api/network/latest${ownerParam}`, {
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

      if (data.gained !== null) setGained((n) => n + data.gained!);

      if (data.imported === 0) {
        // Nothing posted inside the window, or a protected timeline.
        setEmptyRuns((n) => n + 1);
        say(`${prefix} — no posts since Aug 20 · ${secs}s`, "warn");
        return;
      }

      const movement =
        data.postsBefore !== null && data.postsAfter !== null
          ? `${data.postsBefore} → ${data.postsAfter} post(s)`
          : `${data.imported} post(s) stored`;

      say(
        `${prefix} — ${movement}` +
          (data.gained === 0 ? " (all already stored, counts refreshed)" : "") +
          (data.skipped ? ` · ${data.skipped} skipped` : "") +
          (data.duplicates ? ` · ${data.duplicates} dupe(s)` : "") +
          ` · ${secs}s`,
        data.gained === 0 ? "info" : "ok"
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
          say("every account is up to date.", "ok");
          return;
        }

        const batch = all ? pending : pending.slice(0, 1);
        say(
          `${batch.length} handle(s) · up to ${fresh.maxItems} post(s) each · ` +
            `owner ${fresh.ownerId}`
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

  // Progress is measured against the queue as it stood when the page loaded:
  // a handle with nothing new leaves the server-side queue unchanged, so the
  // attempted set is the only honest denominator.
  const total = queue?.total ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Pay-per-result: one result is one post, so the ceiling is handles x
  // maxItems. Quiet accounts cost less than this.
  const cost = queue
    ? ((queue.remaining - done) * queue.maxItems * 0.00025).toFixed(2)
    : "0.00";

  const next =
    queue?.pending.filter((p) => !attempted.current.has(p.rest_id)).slice(0, 12) ??
    [];
  const left = Math.max((queue?.remaining ?? 0) - done, 0);

  return (
    <main className="min-h-screen bg-[#0b0f14] px-6 py-10 font-mono text-[13px] text-slate-300">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] text-slate-100">
            latest posts{" "}
            <span className="text-sky-400">
              · {queue ? shortDate(queue.since) : "Aug 20"} → today
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
          <div className="ml-auto">
            <SweepOwnerSelect
              owner={owner}
              onChange={changeOwner}
              disabled={running}
            />
          </div>
        </div>

        <p className="leading-relaxed text-slate-400">
          Every account on owner{" "}
          <span className="text-slate-200">{queue?.ownerId ?? "…"}</span>&apos;s
          /network cards — the ones with posts stored — ordered by median views.
          One actor run per handle with{" "}
          <span className="text-sky-400">from:@handle</span>, up to{" "}
          <span className="text-slate-200">{queue?.maxItems ?? 20}</span> posts
          from <span className="text-slate-200">
            {queue ? shortDate(queue.since) : "Aug 20"}
          </span>{" "}
          to now. Upserted on tweet_id into{" "}
          <span className="text-slate-200">user_posts</span>: new posts are
          added, stored ones get fresh counts.{" "}
          <span className="text-slate-200">{queue?.fresh ?? 0}</span> account(s)
          fetched in the last {queue?.freshHours ?? 72}h are already up to date
          and left out. Billed per result — up to about ${cost} for the {left}{" "}
          handle(s) left.
        </p>

        <div className="rounded border border-sky-900/60 bg-sky-950/20 px-5 py-4 leading-relaxed text-sky-300">
          Keep this tab open — the loop runs in the browser and stops if the page
          is closed. Stopping is safe: finished handles are already stored, and
          a re-run refreshes engagement counts rather than duplicating posts.
          Handles that return posts drop out of the queue for{" "}
          {queue?.freshHours ?? 72}h, so a stopped sweep resumes where it left
          off. An account with nothing since Aug 20 stays in the queue; it is
          skipped for the rest of this session once attempted.
        </div>

        <div className="relative h-7 w-full overflow-hidden rounded-full border border-slate-700/70 bg-[#111823]">
          <div
            className="absolute inset-y-0 left-0 bg-sky-800/70 transition-[width] duration-500"
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
            <span>{gained} posts gained</span>
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
            className="rounded border border-sky-700/70 bg-sky-900/30 px-4 py-2 text-sky-300 transition-colors hover:bg-sky-900/60 disabled:cursor-not-allowed disabled:opacity-40"
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
                  {c.posts}p · {compact(c.median_views)} med ·{" "}
                  {c.last_fetched_at ? shortDate(c.last_fetched_at) : "—"}
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
              idle — nothing fetched yet this session.
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
                        ? "text-sky-200"
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
