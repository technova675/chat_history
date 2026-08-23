"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Progress = {
  total: number;
  fetched: number;
  remaining: number;
  ok: number;
  notFound: number;
  batchSize: number;
  batchesRemaining: number;
};

type BatchResult = {
  done: boolean;
  requested: number;
  ok: number;
  notFound: number;
  remaining: number;
  elapsedMs?: number;
  message?: string;
  sample?: {
    rest_id: string;
    screen_name: string | null;
    followers: number | null;
  }[];
};

type LogLine = { text: string; tone: "info" | "ok" | "error" };

export default function ScrapePage() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Batch counter for the "batch n/total" prefix, independent of DB state.
  const doneRef = useRef(0);
  const totalBatchesRef = useRef(0);

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [...prev, { text, tone }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/scrape");
    const data = await res.json();
    if (data.error) setError(data.error);
    else setProgress(data);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // One batch. Returns false when there is nothing left or something broke.
  const runBatch = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data: BatchResult & { error?: string } = await res.json();

    if (data.error) {
      say(data.error, "error");
      setError(data.error);
      return false;
    }
    if (data.done) {
      say(data.message ?? "All ids fetched.", "ok");
      return false;
    }

    doneRef.current += 1;
    const secs = ((data.elapsedMs ?? 0) / 1000).toFixed(1);
    const names = data.sample
      ?.map((s) => s.screen_name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    say(
      `batch ${doneRef.current}/${totalBatchesRef.current} · ` +
        `${data.requested} id(s), got ${data.ok} profile(s) · ` +
        `${data.notFound} not found · ${data.remaining} left · ${secs}s` +
        (names ? ` — ${names}` : ""),
      "ok"
    );

    await refresh();
    return data.remaining > 0;
  }, [refresh, say]);

  const start = useCallback(
    async (all: boolean) => {
      setRunning(true);
      setError(null);
      stopRef.current = false;
      doneRef.current = 0;
      totalBatchesRef.current = all ? (progress?.batchesRemaining ?? 0) : 1;

      say(
        `${progress?.remaining ?? 0} id(s) · ${totalBatchesRef.current} batch(es) of ` +
          `${progress?.batchSize ?? 25} to fetch`
      );

      try {
        // Sequential on purpose: the Apify plan is FREE, which limits
        // concurrent actor runs. Parallel batches would start erroring.
        for (;;) {
          if (stopRef.current) {
            say("stopped — finished batches are already stored", "info");
            break;
          }
          const more = await runBatch();
          if (!more || !all) break;
        }
      } catch (e) {
        say(String(e), "error");
        setError(String(e));
      } finally {
        setRunning(false);
      }
    },
    [progress, runBatch, say]
  );

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.fetched / progress.total) * 100)
      : 0;

  const cost = progress ? (progress.remaining * 0.00015).toFixed(2) : "0.00";
  const batchesTotal = progress
    ? Math.ceil(progress.total / progress.batchSize)
    : 0;
  const batchesDone = progress
    ? Math.ceil(progress.fetched / progress.batchSize)
    : 0;

  return (
    <main className="min-h-screen bg-[#0b0f14] px-6 py-10 font-mono text-[13px] text-slate-300">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <p className="leading-relaxed text-slate-400">
          X profiles for every id in <span className="text-slate-200">user.json</span> —
          the unique DM counterparties not already in{" "}
          <span className="text-slate-200">paid_partnership</span>. One synchronous
          actor run per batch of {progress?.batchSize ?? 25}, stored in{" "}
          <span className="text-slate-200">user_info</span>. Billed per result —
          about ${cost} for the {progress?.remaining ?? 0} id(s) still to fetch.
        </p>

        <div className="rounded border border-sky-900/60 bg-sky-950/20 px-5 py-4 leading-relaxed text-sky-300">
          Keep this tab open — the loop runs in the browser and stops if the page
          is closed. Each step is one synchronous actor run. Stopping is safe —
          finished batches are already stored, and a re-run skips profiles already
          bought.
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
              {batchesDone} / {batchesTotal} batches
            </span>
            <span className="text-slate-500">·</span>
            <span>{progress?.ok ?? 0} profiles</span>
            <span className="text-slate-500">·</span>
            <span>{progress?.notFound ?? 0} not found</span>
            <span className="text-slate-500">·</span>
            <span>{pct}%</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => start(true)}
            disabled={running || progress?.remaining === 0}
            className="rounded border border-emerald-700/70 bg-emerald-900/30 px-4 py-2 text-emerald-300 transition-colors hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "running…" : "run all remaining"}
          </button>

          <button
            onClick={() => start(false)}
            disabled={running || progress?.remaining === 0}
            className="rounded border border-slate-700 px-4 py-2 text-slate-300 transition-colors hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            run one batch
          </button>

          {running && (
            <button
              onClick={() => {
                stopRef.current = true;
              }}
              className="rounded border border-red-800/70 px-4 py-2 text-red-400 transition-colors hover:bg-red-950/40"
            >
              stop after this batch
            </button>
          )}

          <span className="ml-auto text-slate-500">
            {progress?.fetched ?? 0} / {progress?.total ?? 0} ids ·{" "}
            {progress?.remaining ?? 0} left
          </span>
        </div>

        {error && (
          <p className="rounded border border-red-900/70 bg-red-950/30 px-4 py-3 text-red-400">
            {error}
          </p>
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
