"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type Owner = {
  owner_id: string;
  screen_name: string;
  name: string | null;
  avatar_url: string | null;
  is_blue_verified: boolean | null;
};

function VerifiedBadge() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label="Verified"
      className="h-[15px] w-[15px] shrink-0 fill-sky-500"
    >
      <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
    </svg>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`${className} shrink-0 animate-spin text-sky-500`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

/** "All" gets a plain initial circle instead of an avatar. */
function AllAvatar({ size = 40 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 font-semibold text-neutral-300"
    >
      A
    </div>
  );
}

function Row({
  owner,
  size = 40,
}: {
  owner: Owner | null;
  size?: number;
}) {
  return (
    <>
      {owner?.avatar_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={owner.avatar_url}
          alt=""
          style={{ width: size, height: size }}
          className="shrink-0 rounded-full bg-neutral-800 object-cover"
        />
      ) : owner ? (
        <div
          style={{ width: size, height: size }}
          className="shrink-0 rounded-full bg-neutral-800"
        />
      ) : (
        <AllAvatar size={size} />
      )}

      <div className="min-w-0 text-left">
        <div className="flex items-center gap-1">
          <span className="truncate text-sm font-bold text-white">
            {owner ? owner.name || owner.screen_name : "All"}
          </span>
          {owner?.is_blue_verified && <VerifiedBadge />}
        </div>
        <p className="truncate text-[13px] text-neutral-500">
          {owner ? `@${owner.screen_name}` : "Every archive"}
        </p>
      </div>
    </>
  );
}

export default function OwnerPicker({
  owners,
  selected,
}: {
  owners: Owner[];
  selected: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Which owner is being navigated to, so the row shows its own spinner.
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = owners.find((o) => o.owner_id === selected) ?? null;

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (ownerId: string | null) => {
    if (pending || ownerId === selected) {
      setOpen(false);
      return;
    }
    setOpen(false);
    setTarget(ownerId);
    // /users is force-dynamic, so the swap is a server round trip. The
    // transition gives us the pending flag to render a loader against.
    startTransition(() => {
      router.push(ownerId ? `/users?owner=${ownerId}` : "/users");
    });
  };

  const targetOwner =
    target === undefined ? null : owners.find((o) => o.owner_id === target) ?? null;
  const targetLabel =
    target === undefined
      ? ""
      : target === null
        ? "All"
        : targetOwner
          ? `@${targetOwner.screen_name}`
          : "";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={pending}
        className="flex w-full items-center gap-3 rounded-full border border-neutral-800 bg-neutral-950 py-2 pl-2 pr-4 transition-colors hover:bg-neutral-900 disabled:cursor-wait sm:w-[260px]"
      >
        <Row owner={pending ? targetOwner : active} />
        {pending ? (
          <Spinner className="ml-auto h-4 w-4" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`ml-auto h-4 w-4 shrink-0 text-neutral-500 transition-transform ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-40 mt-2 w-[280px] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 py-1 shadow-2xl shadow-black/60"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={selected === null}
              onClick={() => choose(null)}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-900 ${
                selected === null ? "bg-neutral-900" : ""
              }`}
            >
              <Row owner={null} />
              {pending && target === null ? (
                <Spinner className="ml-auto h-4 w-4" />
              ) : (
                selected === null && (
                  <span className="ml-auto text-sky-500">✓</span>
                )
              )}
            </button>
          </li>

          {owners.map((owner) => (
            <li key={owner.owner_id}>
              <button
                type="button"
                role="option"
                aria-selected={selected === owner.owner_id}
                onClick={() => choose(owner.owner_id)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-900 ${
                  selected === owner.owner_id ? "bg-neutral-900" : ""
                }`}
              >
                <Row owner={owner} />
                {pending && target === owner.owner_id ? (
                  <Spinner className="ml-auto h-4 w-4" />
                ) : (
                  selected === owner.owner_id && (
                    <span className="ml-auto text-sky-500">✓</span>
                  )
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <>
          {/* Indeterminate bar pinned to the top of the viewport. */}
          <div
            className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-neutral-900"
            role="presentation"
          >
            <div className="h-full w-1/5 bg-sky-500 [animation:owner-switch-sweep_1.1s_ease-in-out_infinite]" />
          </div>

          {/* Dims the stale cards so it is obvious they are being replaced. */}
          <div
            role="status"
            aria-live="polite"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
          >
            <div className="flex items-center gap-3 rounded-full border border-neutral-800 bg-neutral-950 px-5 py-3 shadow-2xl shadow-black/60">
              <Spinner className="h-5 w-5" />
              <span className="text-sm text-neutral-300">
                Loading {targetLabel}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
