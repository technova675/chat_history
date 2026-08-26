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
