"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACTORS, actorName, type OwnerChoices } from "@/lib/actors";

/**
 * Who a vote or format pick is saved for: the owner selected in the archive
 * dropdown. On "All" there is nobody, so a click asks first - see askOwner.
 */
type ActorState = {
  actor: string | null;
  /**
   * Resolves with the owner to save as: the selected one, or - on "All" - the
   * one picked in the popup, null if it was dismissed.
   */
  askOwner: () => Promise<string | null>;
  /** Moves the dropdown to this owner: called after the save goes through. */
  selectOwner: (ownerId: string) => void;
  /**
   * POSTs a vote or format pick. Each option belongs to one owner at a time,
   * so when the server answers that the other owner holds it, this asks
   * before sending it again as a takeover. Resolves with every owner's
   * choices on the account after the save, or null if the takeover was
   * declined. Throws when the save fails.
   */
  saveChoice: (
    endpoint: string,
    body: Record<string, unknown>,
    label: string
  ) => Promise<OwnerChoices | null>;
};

const ActorContext = createContext<ActorState>({
  actor: null,
  askOwner: async () => null,
  selectOwner: () => {},
  saveChoice: async () => null,
});

export function useActor() {
  return useContext(ActorContext);
}

/** What the popup is asking, and where its answer goes. */
type Prompt =
  | { kind: "owner"; resolve: (ownerId: string | null) => void }
  | { kind: "confirm"; message: string; resolve: (yes: boolean) => void };

async function post(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

export function ActorProvider({
  actor,
  children,
}: {
  actor: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const askOwner = useCallback(() => {
    if (actor) return Promise.resolve(actor);
    return new Promise<string | null>((resolve) =>
      setPrompt({ kind: "owner", resolve })
    );
  }, [actor]);

  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) =>
        setPrompt({ kind: "confirm", message, resolve })
      ),
    []
  );

  // Same URL the dropdown builds: every other filter kept, owner swapped in.
  const selectOwner = useCallback(
    (ownerId: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set("owner", ownerId);
      router.push(`${url.pathname}${url.search}`);
    },
    [router]
  );

  const saveChoice = useCallback(
    async (endpoint: string, body: Record<string, unknown>, label: string) => {
      let { status, data } = await post(endpoint, body);

      if (status === 409 && data.heldBy) {
        const yes = await confirm(
          `${label} is already assigned to ${actorName(data.heldBy)}. ` +
            `Are you sure you want to change it to your account?`
        );
        if (!yes) return null;
        ({ status, data } = await post(endpoint, { ...body, takeOver: true }));
      }

      if (data.error) throw new Error(data.error);
      return data.choices as OwnerChoices;
    },
    [confirm]
  );

  const close = () => {
    if (prompt?.kind === "owner") prompt.resolve(null);
    if (prompt?.kind === "confirm") prompt.resolve(false);
    setPrompt(null);
  };

  return (
    <ActorContext.Provider value={{ actor, askOwner, selectOwner, saveChoice }}>
      {children}
      {prompt && (
        <Dialog onClose={close}>
          {prompt.kind === "owner" ? (
            <>
              <h2 id="actor-dialog-title" className="text-base font-semibold text-white">
                Select an owner
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                Votes and formats are saved per owner. Who is this for?
              </p>
              <div className="mt-5 flex gap-3">
                {ACTORS.map((a) => (
                  <button
                    key={a.ownerId}
                    type="button"
                    onClick={() => {
                      prompt.resolve(a.ownerId);
                      setPrompt(null);
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:border-sky-600 hover:text-white"
                  >
                    <span className="rounded border border-sky-700 bg-sky-950/60 px-1.5 text-xs font-bold text-sky-300">
                      {a.letter}
                    </span>
                    {a.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2 id="actor-dialog-title" className="text-base font-semibold text-white">
                Already assigned
              </h2>
              <p className="mt-1 text-sm text-neutral-400">{prompt.message}</p>
              <button
                type="button"
                onClick={() => {
                  prompt.resolve(true);
                  setPrompt(null);
                }}
                className="mt-5 w-full rounded-lg border border-sky-700 bg-sky-950/60 px-4 py-2.5 text-sm font-medium text-sky-200 transition-colors hover:border-sky-500 hover:text-white"
              >
                Yes, change it to my account
              </button>
            </>
          )}
        </Dialog>
      )}
    </ActorContext.Provider>
  );
}

/** Modal shell: dimmed backdrop, Escape or a click outside cancels. */
function Dialog({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Read through a ref so the listener is added once, not on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="actor-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg px-4 py-2 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
