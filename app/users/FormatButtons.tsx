"use client";

import { useState, useTransition } from "react";
import { useActor } from "./ActorContext";
import { viewOf, type OwnerChoices } from "@/lib/actors";

type Format = "heygen" | "text_format" | "personal";

/** Format -> its column in OwnerChoices, and its name in the popup. */
const FORMATS = {
  heygen: { key: "heygen_by", label: "HeyGen" },
  text_format: { key: "text_by", label: "Text" },
  personal: { key: "personal_by", label: "Personal" },
} as const;

/**
 * HEYGEN / TEXT / PERSONAL toggles. Unlike the like/dislike pair these are
 * independent: any, all, or none can be on, and all start off. Each belongs
 * to one owner at a time.
 */
export default function FormatButtons({
  userId,
  choices,
  onChoices,
}: {
  userId: string;
  /** Every owner's picks on this account, held by the card. */
  choices: OwnerChoices;
  /** New choices: the optimistic ones, the server's after a save, or the
   *  previous ones rolled back. */
  onChoices: (choices: OwnerChoices) => void;
}) {
  const { actor, askOwner, selectOwner, saveChoice } = useActor();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // The selected owner's picks, or either owner's on "All".
  const state: Record<Format, boolean> = viewOf(choices, actor);

  const toggle = async (format: Format) => {
    // On "All" this opens the owner popup; dismissing it saves nothing.
    const ownerId = await askOwner();
    if (!ownerId) return;

    const { key, label } = FORMATS[format];
    // The owner's own pick, not the combined one shown on "All".
    const value = !choices[key].includes(ownerId);
    const previous = choices;

    // Optimistic, unless the other owner holds it: that waits for the
    // "already assigned" question.
    const heldByOther = choices[key].some((id) => id !== ownerId);
    if (!value || !heldByOther) {
      onChoices({
        ...choices,
        [key]: value
          ? [...choices[key], ownerId]
          : choices[key].filter((id) => id !== ownerId),
      });
    }
    setFailed(false);

    startTransition(async () => {
      try {
        const saved = await saveChoice(
          "/api/format",
          { userId, ownerId, format, value },
          label
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

      <button
        type="button"
        onClick={() => toggle("personal")}
        aria-pressed={state.personal}
        title={state.personal ? "Unmark Personal" : "Mark Personal"}
        className={pill("personal", "border-teal-700 bg-teal-950/60 text-teal-300")}
      >
        Personal
      </button>

      {failed && (
        <span className="text-[10px] text-red-500" role="alert">
          failed
        </span>
      )}
    </div>
  );
}
