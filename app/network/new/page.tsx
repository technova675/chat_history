"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SweepOwnerSelect, { useSweepOwner } from "../SweepOwner";

/**
 * Driver and progress board for the new-followers sweep: the followers an
 * owner gained in one import window (see the route for the exact query),
 * fetched with the actor input set below.
 *
 * Same loop as the other sweeps - in the browser, one billable run per handle,
 * stoppable between any two - but progress is the server's post count, not a
 * session tally, so reloading the page loses nothing. Sky accent tells this
 * tab apart from the emerald backfill.
 */

type NewAccount = {
  rest_id: string;
  screen_name: string;
  followers: number | null;
  tweets: number | null;
  posts: number;
  last_fetched_at: string | null;
};

type Batch = {
  ownerId: string;
  since: string;
  until: string;
  defaultActor: string;
  accounts: NewAccount[];
};

type RunResult = {
  screenName: string;
  returned: number;
  imported: number;
  own: number | null;
  skipped: number;
  duplicates: number;
  elapsedMs: number;
  error?: string;
};

type LogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };

/** This session's outcome per account, on top of the server's post count. */
type RowState = "running" | "ok" | "empty" | "error";

type Filter = "all" | "pending" | "done" | "attempted";

const QUERY_KEY = "network-new:input";
const ACTOR_KEY = "network-new:actor";
const ACCOUNT_KEY = "network-new:account";

/** The backfill sweep's input: the handle's twenty latest posts, no filters. */
const EXAMPLE_QUERY = `{
  "from": "{handle}",
  "maxItems": 20,
  "queryType": "Latest",
  "filter:blue_verified": false,
  "filter:consumer_video": false,
  "filter:has_engagement": false,
  "filter:hashtags": false,
  "filter:images": false,
  "filter:links": false,
  "filter:media": false,
  "filter:mentions": false,
  "filter:native_video": false,
  "filter:nativeretweets": false,
  "filter:news": false,
  "filter:pro_video": false,
  "filter:quote": false,
  "filter:replies": false,
  "filter:safe": false,
  "filter:spaces": false,
  "filter:twimg": false,
  "filter:videos": false,
  "filter:vine": false,
  "include:nativeretweets": false
}`;

function readPref(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage: the field still works, it just
    // will not be remembered.
  }
}

/** 1.2K / 3.4M, matching the card formatting. */
function compact(n: number | null): string {
  if (n === null) return "—";
  return Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NetworkNewPage() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const stopRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [account, setAccount] = useState<"1" | "2">("1");

  // Remembered per browser, so the pasted query survives a reload. Read in an
  // effect, not a lazy initializer: localStorage does not exist on the server
  // render, and reading it there would mismatch on hydration.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(readPref(QUERY_KEY, EXAMPLE_QUERY));
    setActor(readPref(ACTOR_KEY, ""));
    setAccount(readPref(ACCOUNT_KEY, "1") === "2" ? "2" : "1");
  }, []);

  const parsed = useMemo((): { value: Record<string, unknown> } | { error: string } => {
    try {
      const value = JSON.parse(query);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { error: "must be a JSON object" };
      }
      return { value };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [query]);

  const say = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    setLog((prev) => [...prev, { text, tone }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  const [owner, setOwner] = useSweepOwner();
  const ownerParam = owner ? `?owner=${encodeURIComponent(owner)}` : "";

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/network/new${ownerParam}`);
    const data = await res.json();
    if (data.error) setError(data.error);
    else setBatch(data);
    return data as Batch;
  }, [ownerParam]);

  useEffect(() => {
    if (!owner) return;
    refresh().catch((e) => setError(String(e)));
  }, [owner, refresh]);

  const changeOwner = useCallback(
    (next: string) => {
      setRowState({});
      setBatch(null);
      setError(null);
      setOwner(next);
    },
    [setOwner]
  );

  /** One handle: one billable actor run. */
  const runOne = useCallback(
    async (a: NewAccount, index: number, total: number, input: Record<string, unknown>) => {
      setCurrent(a.rest_id);
      setRowState((s) => ({ ...s, [a.rest_id]: "running" }));

      const res = await fetch(`/api/network/new${ownerParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenName: a.screen_name,
          restId: a.rest_id,
          query: input,
          actor: actor.trim() || undefined,
          account,
        }),
      });
      const data: RunResult = await res.json();
      const secs = (data.elapsedMs / 1000).toFixed(1);
      const prefix = `${index}/${total} @${a.screen_name}`;

      if (data.error) {
        setRowState((s) => ({ ...s, [a.rest_id]: "error" }));
        say(`${prefix} — ${data.error} · ${secs}s`, "error");
        return;
      }

      if (data.imported === 0) {
        setRowState((s) => ({ ...s, [a.rest_id]: "empty" }));
        say(`${prefix} — no posts returned · ${secs}s`, "warn");
        return;
      }

      setRowState((s) => ({ ...s, [a.rest_id]: "ok" }));
      // Optimistic: the next refresh replaces this with the stored count.
      setBatch((b) =>
        b && {
          ...b,
          accounts: b.accounts.map((x) =>
            x.rest_id === a.rest_id
              ? {
                  ...x,
                  posts: Math.max(x.posts, data.own ?? data.imported),
                  last_fetched_at: new Date().toISOString(),
                }
              : x
          ),
        }
      );
      say(
        `${prefix} — ${data.imported} post(s) stored` +
          (data.own !== null && data.own !== data.imported
            ? ` · ${data.own} by this account`
            : "") +
          (data.skipped ? ` · ${data.skipped} skipped` : "") +
          (data.duplicates ? ` · ${data.duplicates} dupe(s)` : "") +
          ` · ${secs}s`,
        "ok"
      );
    },
    [ownerParam, actor, account, say]
  );

  const start = useCallback(
    async (all: boolean) => {
      if (!("value" in parsed)) {
        setError(`actor input is not valid JSON: ${parsed.error}`);
        return;
      }
      const input = parsed.value;
      writePref(QUERY_KEY, query);
      writePref(ACTOR_KEY, actor);
      writePref(ACCOUNT_KEY, account);

      setRunning(true);
      setError(null);
      stopRef.current = false;

      try {
        const fresh = await refresh();
        // Pending = no posts stored and not already tried this session; an
        // account the query finds nothing for would otherwise loop forever.
        const pending = (fresh.accounts ?? []).filter(
          (a) => a.posts === 0 && !rowState[a.rest_id]
        );

        if (pending.length === 0) {
          say("nothing left to fetch.", "ok");
          return;
        }

        const todo = all ? pending : pending.slice(0, 1);
        say(
          `${todo.length} handle(s) · actor ${actor.trim() || fresh.defaultActor} · ` +
            `apify account ${account} · owner ${fresh.ownerId}`
        );

        // Sequential on purpose: the Apify plan limits concurrent actor runs.
        for (const [i, a] of todo.entries()) {
          if (stopRef.current) {
            say("stopped — finished handles are already stored", "info");
            break;
          }
          await runOne(a, i + 1, todo.length, input);
        }

        await refresh();
      } catch (e) {
        say(String(e), "error");
        setError(String(e));
      } finally {
        setCurrent(null);
        setRunning(false);
      }
    },
    [parsed, query, actor, account, refresh, rowState, runOne, say]
  );

  const accounts = batch?.accounts ?? [];
  const total = accounts.length;
  const done = accounts.filter((a) => a.posts > 0).length;
  const tried = accounts.filter((a) => a.posts === 0 && rowState[a.rest_id]).length;
  const left = total - done - tried;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const triedPct = total > 0 ? Math.round((tried / total) * 100) : 0;

  const shown = accounts.filter((a) =>
    filter === "done"
      ? a.posts > 0
      : filter === "pending"
        ? a.posts === 0 && !rowState[a.rest_id]
        : filter === "attempted"
          ? a.posts === 0 && !!rowState[a.rest_id]
          : true
  );

  return (
    <main className="min-h-screen bg-[#0b0f14] px-6 py-10 font-mono text-[13px] text-slate-300">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[15px] text-slate-100">
            new followers <span className="text-sky-400">· sim · fetch posts</span>
          </h1>
          <a href="/network" className="text-slate-500 transition-colors hover:text-slate-300">
            /network
          </a>
          <a
            href="/network/backfill"
            className="text-slate-500 transition-colors hover:text-slate-300"
          >
            backfill
          </a>
          <div className="ml-auto">
            <SweepOwnerSelect owner={owner} onChange={changeOwner} disabled={running} />
          </div>
        </div>

        <p className="leading-relaxed text-slate-400">
          The <span className="text-slate-200">{total}</span> follower(s) of owner{" "}
          <span className="text-slate-200">{batch?.ownerId ?? "…"}</span> imported
          from <span className="text-slate-200">{when(batch?.since ?? null)}</span> to{" "}
          <span className="text-slate-200">{when(batch?.until ?? null)}</span> (UTC
          window, shown in local time), most active first. An account appears on
          /network once it has posts stored. Each run sends the actor input
          below with <span className="text-sky-400">{"{handle}"}</span> replaced by
          the account&apos;s handle (and <span className="text-sky-400">{"{now}"}</span>{" "}
          by the unix time); input without {"{handle}"} gets{" "}
          <span className="text-sky-400">from: handle</span> added.
        </p>

        <div className="grid gap-3 md:grid-cols-[1fr_280px]">
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-slate-500">
              actor input JSON
              {"error" in parsed ? (
                <span className="text-red-400">— {parsed.error}</span>
              ) : (
                <span className="text-sky-500">— valid</span>
              )}
            </span>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={running}
              spellCheck={false}
              rows={10}
              className="w-full resize-y rounded border border-slate-700 bg-[#0d1219] p-3 text-[12px] leading-relaxed text-slate-200 outline-none focus:border-sky-700 disabled:opacity-60"
            />
          </label>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-slate-500">actor</span>
              <input
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                disabled={running}
                placeholder={batch?.defaultActor ?? "default actor"}
                spellCheck={false}
                className="rounded border border-slate-700 bg-[#0d1219] px-2 py-1.5 text-[12px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-700 disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-slate-500">apify account</span>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value === "2" ? "2" : "1")}
                disabled={running}
                className="rounded border border-slate-700 bg-[#0d1219] px-2 py-1.5 text-slate-200 disabled:opacity-60"
              >
                <option value="1">1 · APIFY_TOKEN</option>
                <option value="2">2 · APIFY_TOKEN_2</option>
              </select>
            </label>
            <p className="text-[11px] leading-relaxed text-slate-600">
              Don&apos;t share an account with another sweep running at the same
              time — the free plan caps concurrent runs.
            </p>
          </div>
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
          <div
            className="absolute inset-y-0 bg-amber-900/50 transition-[width,left] duration-500"
            style={{ left: `${pct}%`, width: `${triedPct}%` }}
          />
          <div className="relative flex h-full items-center justify-center gap-2 text-[12px] text-slate-200">
            <span>
              {done} / {total} with posts
            </span>
            <span className="text-slate-500">·</span>
            <span>{tried} tried, none found</span>
            <span className="text-slate-500">·</span>
            <span>{left} left</span>
            <span className="text-slate-500">·</span>
            <span>{pct}%</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => start(true)}
            disabled={running || left === 0 || "error" in parsed}
            className="rounded border border-sky-700/70 bg-sky-900/30 px-4 py-2 text-sky-300 transition-colors hover:bg-sky-900/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "running…" : "run all remaining"}
          </button>
          <button
            onClick={() => start(false)}
            disabled={running || left === 0 || "error" in parsed}
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
          <button
            onClick={() => refresh().catch((e) => setError(String(e)))}
            disabled={running}
            className="ml-auto text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-40"
          >
            refresh
          </button>
        </div>

        {error && (
          <p className="rounded border border-red-900/70 bg-red-950/30 px-4 py-3 text-red-400">
            {error}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", total],
                  ["pending", left],
                  ["done", done],
                  ["attempted", tried],
                ] as const
              ).map(([key, n]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                    filter === key
                      ? "border-sky-700 bg-sky-900/40 text-sky-200"
                      : "border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {key} {n}
                </button>
              ))}
            </div>
            <div className="h-[420px] overflow-y-auto rounded border border-slate-800 bg-[#0d1219]">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-[#0d1219] text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-normal">account</th>
                    <th className="px-2 py-2 font-normal">tweets</th>
                    <th className="px-2 py-2 font-normal">posts</th>
                    <th className="px-3 py-2 font-normal">status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => {
                    const st = rowState[a.rest_id];
                    const status =
                      current === a.rest_id
                        ? ["fetching…", "text-sky-300"]
                        : a.posts > 0
                          ? ["done", "text-emerald-400"]
                          : st === "error"
                            ? ["error", "text-red-400"]
                            : st === "empty"
                              ? ["none found", "text-amber-400"]
                              : ["pending", "text-slate-600"];
                    return (
                      <tr
                        key={a.rest_id}
                        className={`border-t border-slate-800/60 ${
                          current === a.rest_id ? "bg-sky-950/40" : ""
                        }`}
                      >
                        <td className="px-3 py-1.5">
                          <a
                            href={`https://x.com/${a.screen_name}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-200 hover:text-sky-300"
                          >
                            @{a.screen_name}
                          </a>
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">{compact(a.tweets)}</td>
                        <td className="px-2 py-1.5 text-slate-400">{a.posts || "—"}</td>
                        <td className={`px-3 py-1.5 ${status[1]}`}>{status[0]}</td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-600">
                        {batch ? "no accounts here" : "loading…"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="py-0.5 text-[11px] text-slate-500">log</span>
            <div className="h-[420px] overflow-y-auto rounded border border-slate-800 bg-[#0d1219] p-4 leading-[1.9]">
              {log.length === 0 ? (
                <p className="text-slate-600">idle — nothing fetched yet this session.</p>
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
                            ? "text-sky-300"
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
        </div>
      </div>
    </main>
  );
}
