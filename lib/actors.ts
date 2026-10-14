/**
 * The two people who vote: each is an archive owner. A vote or format pick is
 * saved for the owner selected in the archive dropdown; on "All" the card asks
 * which one first (app/users/ActorContext.tsx).
 *
 * Client-safe: no server imports here, the cards read this too.
 */
export const ACTORS = [
  { letter: "V", name: "Vir", ownerId: "3018488785" },
  { letter: "S", name: "Sim", ownerId: "958230722292064256" },
] as const;

/** The owner id if it is one of the two, else null. */
export function parseActor(value: unknown): string | null {
  return ACTORS.some((a) => a.ownerId === value) ? (value as string) : null;
}

/** "Vir" / "Sim" for an owner id, for the popups. */
export function actorName(ownerId: string): string {
  return ACTORS.find((a) => a.ownerId === ownerId)?.name ?? ownerId;
}

/**
 * Per-owner choices on one account: which owners made each one.
 *
 * Each option belongs to one owner at a time: taking one the other owner holds
 * moves it rather than sharing it (/api/vote, /api/format). Picks made before
 * that rule can still sit with both, and stay so until someone clicks.
 */
export type OwnerChoices = {
  liked_by: string[];
  disliked_by: string[];
  heygen_by: string[];
  text_by: string[];
  personal_by: string[];
};

export const NO_CHOICES: OwnerChoices = {
  liked_by: [],
  disliked_by: [],
  heygen_by: [],
  text_by: [],
  personal_by: [],
};

/**
 * What the card shows for those choices. The buttons show the selected
 * owner's own vote and format picks, or - on "All" - both owners' combined.
 * acted_by is every owner who has voted or picked a format, which is what the
 * V / S badges light up from.
 */
export function viewOf(c: OwnerChoices, actor: string | null) {
  const mine = (ids: string[]) =>
    actor === null ? ids.length > 0 : ids.includes(actor);
  return {
    vote: mine(c.liked_by)
      ? ("like" as const)
      : mine(c.disliked_by)
        ? ("dislike" as const)
        : ("none" as const),
    heygen: mine(c.heygen_by),
    text_format: mine(c.text_by),
    personal: mine(c.personal_by),
    acted_by: [
      ...new Set([
        ...c.liked_by,
        ...c.disliked_by,
        ...c.heygen_by,
        ...c.text_by,
        ...c.personal_by,
      ]),
    ],
  };
}
