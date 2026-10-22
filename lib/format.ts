/**
 * Shared formatting. Its own module because both server components and client
 * components call it: a "use client" file cannot export a plain function to
 * the server.
 */

/** 1234 -> "1.2K", 285039 -> "285K", null -> "—". */
export function compact(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}K`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * "2026-10-12T08:01:02+00:00" -> "Oct 12, 2026". Fixed locale and zone: the
 * cards render on the server and again in the browser, and the two have to
 * print the same string or hydration fails.
 */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
