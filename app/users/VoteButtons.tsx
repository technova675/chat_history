"use client";

import { useState, useTransition } from "react";

import { useActor } from "./ActorContext";
import { viewOf, type OwnerChoices } from "@/lib/actors";

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
  choices,
  onChoices,
}: {
  userId: string;
  /** Every owner's votes on this account, held by the card. */
  choices: OwnerChoices;
  /** New choices: the optimistic ones, the server's after a save, or the
   *  previous ones rolled back. */
  onChoices: (choices: OwnerChoices) => void;
}) {
  const { actor, askOwner, selectOwner, saveChoice } = useActor();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // The selected owner's vote, or either owner's on "All".
  const vote: Vote = (() => {
    const v = viewOf(choices, actor).vote;
    return v === "none" ? null : v;
  })();

  const cast = async (next: "like" | "dislike") => {
    // On "All" this opens the owner popup; dismissing it saves nothing.
    const ownerId = await askOwner();
    if (!ownerId) return;

    const list = next === "like" ? "liked_by" : "disliked_by";
    // Clicking your own active vote clears it. The owner's own vote, not the
    // combined one shown on "All".
    const value: Vote = choices[list].includes(ownerId) ? null : next;
    const previous = choices;

    // Optimistic, unless the other owner holds it: that waits for the
    // "already assigned" question.
    const heldByOther = choices[list].some((id) => id !== ownerId);
    if (value === null || !heldByOther) {
      const without = (ids: string[]) => ids.filter((id) => id !== ownerId);
      onChoices({
        ...choices,
        liked_by: [...without(choices.liked_by), ...(value === "like" ? [ownerId] : [])],
        disliked_by: [...without(choices.disliked_by), ...(value === "dislike" ? [ownerId] : [])],
      });
    }
    setFailed(false);

    startTransition(async () => {
      try {
        const saved = await saveChoice(
          "/api/vote",
          { userId, ownerId, vote: value },
          next === "like" ? "Like" : "Dislike"
        );
        // null: the takeover was declined, nothing was saved.
        onChoices(saved ?? previous);
        if (saved && !actor) selectOwner(ownerId);
      } catch {
        onChoices(previous); // roll back
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
