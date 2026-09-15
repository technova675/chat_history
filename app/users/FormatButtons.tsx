"use client";

import { useState, useTransition } from "react";

type Format = "heygen" | "text_format";

/**
 * HEYGEN / TEXT toggles. Unlike the like/dislike pair these are independent:
 * either, both, or neither can be on, and both start off.
 */
export default function FormatButtons({
  userId,
  initialHeygen,
  initialText,
}: {
  userId: string;
  initialHeygen: boolean;
  initialText: boolean;
}) {
  const [state, setState] = useState<Record<Format, boolean>>({
    heygen: initialHeygen,
    text_format: initialText,
  });
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const toggle = (format: Format) => {
    const value = !state[format];
    const previous = state;

    setState({ ...state, [format]: value }); // optimistic
    setFailed(false);

    startTransition(async () => {
      try {
        const res = await fetch("/api/format", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, format, value }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      } catch {
        setState(previous); // roll back
        setFailed(true);
      }
    });
  };

  const pill = (format: Format, on: string) =>
    `rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
      state[format]
        ? on
        : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
    }`;

  return (
    <div className="flex items-center gap-1.5" aria-busy={pending}>
      <button
        type="button"
        onClick={() => toggle("heygen")}
        aria-pressed={state.heygen}
        title={state.heygen ? "Unmark HeyGen" : "Mark HeyGen"}
        className={pill("heygen", "border-violet-700 bg-violet-950/60 text-violet-300")}
      >
        HeyGen
      </button>

      <button
        type="button"
        onClick={() => toggle("text_format")}
        aria-pressed={state.text_format}
        title={state.text_format ? "Unmark Text" : "Mark Text"}
        className={pill("text_format", "border-amber-700 bg-amber-950/60 text-amber-300")}
      >
        Text
      </button>

      {failed && (
        <span className="text-[10px] text-red-500" role="alert">
          failed
        </span>
      )}
    </div>
  );
}
