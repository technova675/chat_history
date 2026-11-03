import { DEFAULT_SORT, type SortKey } from "@/lib/userCards";

/**
 * Disliked true / false switch, shared by /users and /network and styled like
 * SortPicker.
 *
 * It narrows whichever pill is on: Followers + false is the followers the
 * selected owner has not disliked. Clicking the active option turns it off.
 */
export default function DislikedPicker({
  basePath,
  sort,
  active,
  extraParams = {},
}: {
  /** "/users" or "/network". */
  basePath: string;
  sort: SortKey;
  active: boolean | null;
  /** Whatever else the page keeps in the URL - owner, vote, rel. Null drops. */
  extraParams?: Record<string, string | null>;
}) {
  const href = (value: boolean) => {
    const params = new URLSearchParams();
    for (const [key, v] of Object.entries(extraParams)) {
      if (v) params.set(key, v);
    }
    if (active !== value) params.set("disliked", String(value));
    if (sort !== DEFAULT_SORT) params.set("sort", sort);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-800">
      <span className="bg-neutral-900/60 px-3 py-1.5 text-xs font-medium text-neutral-300">
        Disliked
      </span>
      {([true, false] as const).map((value) => (
        <a
          key={String(value)}
          href={href(value)}
          aria-current={active === value ? "true" : undefined}
          className={`border-l border-neutral-800 px-3 py-1.5 text-xs transition-colors ${
            active === value
              ? "bg-sky-950/60 font-medium text-sky-400"
              : "bg-neutral-950 text-neutral-500 hover:bg-neutral-900 hover:text-white"
          }`}
        >
          {value ? "true" : "false"}
        </a>
      ))}
    </div>
  );
}
