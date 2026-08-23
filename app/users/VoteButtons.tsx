"use client";

import { useState, useTransition } from "react";

type Vote = "like" | "dislike" | null;

function ThumbUpIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm0 0 4.5-7a2 2 0 0 1 3.4 2l-1.2 5h5.1a2 2 0 0 1 2 2.4l-1.4 7a2 2 0 0 1-2 1.6H7" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3zm0 0 4.5 7a2 2 0 0 0 3.4-2l-1.2-5h5.1a2 2 0 0 0 2-2.4l-1.4-7A2 2 0 0 0 17.4 3H7" />
    </svg>
  );
}

export default function VoteButtons({
  userId,
  initialVote,
}: {
  userId: string;
  initialVote: Vote;
}) {
  const [vote, setVote] = useState<Vote>(initialVote);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const cast = (next: Vote) => {
    // Clicking the active button clears the vote.
    const value = vote === next ? null : next;
    const previous = vote;

    setVote(value); // optimistic
    setFailed(false);

    startTransition(async () => {
      try {
        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, vote: value }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      } catch {
        setVote(previous); // roll back
        setFailed(true);
      }
    });
  };

  return (
    <div className="flex items-center gap-1.5" aria-busy={pending}>
      <button
        type="button"
        onClick={() => cast("like")}
        aria-pressed={vote === "like"}
        aria-label="Like"
        title={vote === "like" ? "Remove like" : "Like"}
        className={`inline-flex items-center justify-center rounded-full border p-2 transition-colors ${
          vote === "like"
            ? "border-emerald-700 bg-emerald-950/60 text-emerald-400"
            : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        }`}
      >
        <ThumbUpIcon />
      </button>

      <button
        type="button"
        onClick={() => cast("dislike")}
        aria-pressed={vote === "dislike"}
        aria-label="Dislike"
        title={vote === "dislike" ? "Remove dislike" : "Dislike"}
        className={`inline-flex items-center justify-center rounded-full border p-2 transition-colors ${
          vote === "dislike"
            ? "border-red-800 bg-red-950/60 text-red-400"
            : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        }`}
      >
        <ThumbDownIcon />
      </button>

      {failed && (
        <span className="text-[10px] text-red-500" role="alert">
          failed
        </span>
      )}
    </div>
  );
}
