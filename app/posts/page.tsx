"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Queue = {
  ownerId: string;
  total: number;
  done: number;
  remaining: number;
  maxItems: number;
  pending: string[];
};

type StepResult = {
  screenName: string;
  returned: number;
  imported: number;
  skipped: number;
  duplicates: number;
  elapsedMs: number;
  error?: string;
};

type LogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };

/** Breathing room between actor runs so we don't trip Apify concurrency. */
const PAUSE_MS = 1000;

export default function PostsScrapePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ handles: 0, tweets: 0, failed: 0 });

  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [...prev, { text, tone }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/posts/scrape");
    const data = await res.json();
    if (data.error) setError(data.error);
    else setQueue(data);
    return data as Queue;
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    stopRef.current = false;
    setStats({ handles: 0, tweets: 0, failed: 0 });

    try {
      // Re-read the queue first so a re-run skips whatever landed last pass.
      const fresh = await refresh();
      const pending = fresh?.pending ?? [];

      if (pending.length === 0) {
        say("nothing pending - every handle already has posts.", "ok");
        return;
      }

      say(`${pending.length} handle(s) to scrape · ${fresh.maxItems} tweets each`);

      let handles = 0;
      let tweets = 0;
      let failed = 0;

      for (const [i, screenName] of pending.entries()) {
        if (stopRef.current) {
          say("stopped - everything already fetched is stored", "info");
          break;
        }

        const res = await fetch("/api/posts/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screenName }),
        });
        const data: StepResult = await res.json();
        const secs = ((data.elapsedMs ?? 0) / 1000).toFixed(1);
        const at = `[${i + 1}/${pending.length}]`;

        if (data.error) {
          failed++;
          say(`${at} ${screenName}: ${data.error}`, "error");
        } else if (data.imported === 0) {
          // No tweets in the window is a valid outcome, but the handle stays
          // pending in the DB, so a later run will try it again.
          say(`${at} ${screenName}: no tweets in range · ${secs}s`, "warn");
        } else {
          handles++;
          tweets += data.imported;
          const dropped = data.skipped > 0 ? ` · ${data.skipped} unusable` : "";
          say(
            `${at} ${screenName}: ${data.imported} tweet(s) stored${dropped} · ${secs}s`,
            "ok"
          );
        }

        setStats({ handles, tweets, failed });
        setQueue((q) =>
          q
            ? {
                ...q,
                done: q.done + (data.imported > 0 ? 1 : 0),
                remaining: q.remaining - 1,
              }
            : q
        );

        if (i < pending.length - 1) {
          await new Promise((r) => setTimeout(r, PAUSE_MS));
        }
      }

      say(
        `finished - ${handles} handle(s), ${tweets} tweet(s) stored, ${failed} failed`,
        failed > 0 ? "warn" : "ok"
      );
      await refresh();
    } catch (e) {
      say(String(e), "error");
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [refresh, say]);

  const pct =
    queue && queue.total > 0 ? Math.round((queue.done / queue.total) * 100) : 0;

  return (
    <main className="min-h-screen bg-[#0b0f14] px-6 py-10 font-mono text-[13px] text-slate-300">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <h1 className="text-lg text-slate-100">Post scrape pipeline</h1>

        <p className="leading-relaxed text-slate-400">
          The newest {queue?.maxItems ?? 20} English non-reply tweets for every DM
          counterparty in the archive, ordered by followers. One synchronous actor
          run per handle, written straight to{" "}
          <span className="text-slate-200">user_posts</span> — no intermediate
          file. <span className="text-slate-200">user_posts_summary</span> is a
          view, so it updates itself.
        </p>

        <div className="rounded border border-sky-900/60 bg-sky-950/20 px-5 py-4 leading-relaxed text-sky-300">
          Keep this tab open — the loop runs in the browser and stops if the page
          is closed. Each step is one synchronous actor run. Stopping is safe:
          finished handles are already stored, and a re-run skips handles that
          already have tweets.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={start}
            disabled={running || queue?.remaining === 0}
            className="rounded border border-emerald-700/70 bg-emerald-900/30 px-4 py-2 text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "running…" : "Start"}
          </button>

          <button
            onClick={() => {
              stopRef.current = true;
            }}
            disabled={!running}
            className="rounded border border-slate-700 px-4 py-2 text-slate-300 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop
          </button>

          <span className="ml-auto text-slate-500">
            {queue?.done ?? 0} / {queue?.total ?? 0} handles ·{" "}
            {queue?.remaining ?? 0} left
          </span>
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
              {queue?.done ?? 0} / {queue?.total ?? 0} handles
            </span>
            <span className="text-slate-500">·</span>
            <span>{stats.tweets} tweets</span>
            <span className="text-slate-500">·</span>
            <span>{stats.failed} failed</span>
            <span className="text-slate-500">·</span>
            <span>{pct}%</span>
          </div>
        </div>

        {error && (
          <p className="rounded border border-red-900/70 bg-red-950/30 px-4 py-3 text-red-400">
            {error}
          </p>
        )}

        <div className="h-[420px] overflow-y-auto rounded border border-slate-800 bg-[#0d1219] p-4 leading-[1.9]">
          {log.length === 0 ? (
            <p className="text-slate-600">idle — nothing scraped yet this session.</p>
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
