"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ACTORS } from "@/lib/actors";

/** The owner the sweep APIs fall back to without ?owner= (Sim). */
const DEFAULT_OWNER = "958230722292064256";

/** replaceState fires no event of its own, so setOwner sends this one. */
const CHANGE_EVENT = "sweep-owner";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function ownerFromUrl(): string {
  const owner = new URLSearchParams(window.location.search).get("owner");
  return ACTORS.some((a) => a.ownerId === owner) ? owner! : DEFAULT_OWNER;
}

/**
 * Whose graph a sweep page drives, kept in ?owner= so a reload or a shared
 * link stays on the same owner.
 *
 * Null on the server: the URL is only readable in the browser, and rendering
 * the default there would load the wrong owner's queue first.
 */
export function useSweepOwner() {
  const owner = useSyncExternalStore(subscribe, ownerFromUrl, () => null);

  const setOwner = useCallback((next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("owner", next);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [owner, setOwner] as const;
}

/** Owner dropdown for the sweep pages. Locked while a loop is running. */
export default function SweepOwnerSelect({
  owner,
  onChange,
  disabled,
}: {
  owner: string | null;
  onChange: (owner: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-slate-500">
      owner
      <select
        value={owner ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || owner === null}
        className="rounded border border-slate-700 bg-[#0d1219] px-2 py-1 text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {ACTORS.map((a) => (
          <option key={a.ownerId} value={a.ownerId}>
            {a.name} · {a.ownerId}
          </option>
        ))}
      </select>
    </label>
  );
}
