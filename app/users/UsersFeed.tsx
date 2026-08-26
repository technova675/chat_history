"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import UserCard, { type CardRow } from "./UserCard";

/**
 * The card grid. The server renders the first page; this appends the rest as
 * the sentinel below the grid scrolls into view, so revisiting /users costs
 * one page of rows instead of the whole table.
 */
export default function UsersFeed({
  initialUsers,
  total,
  ownerId,
  vote,
  pageSize,
}: {
  initialUsers: CardRow[];
  total: number;
  ownerId: string | null;
  vote: string | null;
  // A prop, not an import: PAGE_SIZE lives beside the loaders in
  // lib/userCards.ts, which pulls in the service-role client.
  pageSize: number;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  // Read inside the observer callback, which closes over its first render.
  const stateRef = useRef({ count: initialUsers.length, loading: false });

  // One slot per filter combination, so switching owner or vote starts fresh.
  const memoryKey = `users:${ownerId ?? "all"}:${vote ?? "all"}`;
  // Blocks the observer while the saved pages are being refetched, otherwise
  // it fires against a short page and double-loads the same rows.
  const restoringRef = useRef(false);

  /** Remember how far down the list we were, for the trip back. */
  const remember = useCallback(() => {
    try {
      sessionStorage.setItem(
        memoryKey,
        JSON.stringify({ count: stateRef.current.count, y: window.scrollY })
      );
    } catch {
      // Private mode, or storage full: losing the position is not worth
      // breaking the feed over.
    }
  }, [memoryKey]);

  const loadMore = useCallback(async () => {
    if (stateRef.current.loading || restoringRef.current) return;
    if (stateRef.current.count >= total) return;

    stateRef.current.loading = true;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        offset: String(stateRef.current.count),
        limit: String(pageSize),
      });
      if (ownerId) params.set("owner", ownerId);
      if (vote) params.set("vote", vote);

      const res = await fetch(`/api/users?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const rows = (data.users ?? []) as CardRow[];
      stateRef.current.count += rows.length;
      setUsers((prev) => [...prev, ...rows]);
      remember();
    } catch (e) {
      setError(String(e));
    } finally {
      stateRef.current.loading = false;
      setLoading(false);
    }
  }, [ownerId, pageSize, remember, total, vote]);

  /**
   * Coming back from a card: refetch the pages that were open and drop the
   * scroll back where it was. One request for the whole backlog rather than
   * a page at a time, so the jump happens before the first paint the user
   * would notice.
   */
  useEffect(() => {
    let saved: { count: number; y: number } | null = null;
    try {
      const raw = sessionStorage.getItem(memoryKey);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }

    if (!saved || saved.count <= initialUsers.length) return;

    // The browser would otherwise restore a scroll position measured against
    // the full-length list, on a page currently one screen tall.
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    restoringRef.current = true;

    const target = Math.min(saved.count, total);
    let cancelled = false;

    (async () => {
      try {
        const rows: CardRow[] = [];
        // /api/users caps limit at 100, so a deep backlog takes a few trips.
        while (initialUsers.length + rows.length < target) {
          const offset = initialUsers.length + rows.length;
          const params = new URLSearchParams({
            offset: String(offset),
            limit: String(Math.min(100, target - offset)),
          });
          if (ownerId) params.set("owner", ownerId);
          if (vote) params.set("vote", vote);

          const data = await fetch(`/api/users?${params}`).then((r) => r.json());
          if (cancelled || data.error) break;

          const batch = (data.users ?? []) as CardRow[];
          if (batch.length === 0) break;
          rows.push(...batch);
        }

        if (cancelled || rows.length === 0) return;
        stateRef.current.count += rows.length;
        setUsers((prev) => [...prev, ...rows]);

        // Two frames: one for React to commit the rows, one for the browser
        // to lay them out and give the document its full height.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!cancelled) window.scrollTo(0, saved.y);
            restoringRef.current = false;
          })
        );
      } catch {
        restoringRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      restoringRef.current = false;
      history.scrollRestoration = previous;
    };
    // Runs once per mount: a filter change remounts via the key on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Save the position on the way out, including a plain link click. */
  useEffect(() => {
    const onLeave = () => remember();
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [remember]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    // rootMargin starts the next page one screen early, so scrolling stays
    // continuous instead of stalling at the bottom of the grid.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const done = users.length >= total;

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {users.map((user, i) => (
          <UserCard key={user.rest_id} user={user} index={i} />
        ))}
      </div>

      <div ref={sentinelRef} className="py-6 text-center text-sm text-neutral-500">
        {error ? (
          <span className="text-red-400">
            {error}{" "}
            <button
              onClick={loadMore}
              className="underline transition-colors hover:text-red-300"
            >
              retry
            </button>
          </span>
        ) : loading ? (
          <span>loading…</span>
        ) : done ? (
          <span>
            {total.toLocaleString()} account{total === 1 ? "" : "s"} — end of list
          </span>
        ) : (
          <span>
            {users.length} of {total.toLocaleString()}
          </span>
        )}
      </div>
    </>
  );
}
