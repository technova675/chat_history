import { DEFAULT_SORT, type SortKey } from "@/lib/userCards";

/**
 * Card order control, shared by /users and /network.
 *
 * Links rather than a <select>, for the same reason the filter pills are
 * links: the order is part of the URL, so a sorted view can be shared,
 * bookmarked, and returned to by the back arrow on /user_post.
 *
 * Each direction is labelled in words. An arrow alone leaves the reader
 * guessing which end of the list they are about to get.
 */
export default function SortPicker({
  basePath,
  active,
  extraParams = {},
}: {
  /** "/users" or "/network". */
  basePath: string;
  active: SortKey;
  /** Whatever else the page keeps in the URL - owner, vote, rel. Null drops. */
  extraParams?: Record<string, string | null>;
}) {
  const href = (sort: SortKey) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams)) {
      if (value) params.set(key, value);
    }
    // The default is the absence of the parameter, so the plain URL is clean.
    if (sort !== DEFAULT_SORT) params.set("sort", sort);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const fields = [
    {
      label: "Followers",
      high: { sort: "followers_desc" as SortKey, text: "most first" },
      low: { sort: "followers_asc" as SortKey, text: "fewest first" },
    },
    {
      label: "Total views",
      high: { sort: "total_views_desc" as SortKey, text: "highest first" },
      low: { sort: "total_views_asc" as SortKey, text: "lowest first" },
    },
    {
      label: "Median views",
      high: { sort: "median_views_desc" as SortKey, text: "highest first" },
      low: { sort: "median_views_asc" as SortKey, text: "lowest first" },
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
        Sort by
      </span>

      {fields.map((field) => (
        <div
          key={field.label}
          className="inline-flex items-center overflow-hidden rounded-lg border border-neutral-800"
        >
          <span className="bg-neutral-900/60 px-3 py-1.5 text-xs font-medium text-neutral-300">
            {field.label}
          </span>
          {[field.high, field.low].map((option) => (
            <a
              key={option.sort}
              href={href(option.sort)}
              aria-current={active === option.sort ? "true" : undefined}
              className={`border-l border-neutral-800 px-3 py-1.5 text-xs transition-colors ${
                active === option.sort
                  ? "bg-sky-950/60 font-medium text-sky-400"
                  : "bg-neutral-950 text-neutral-500 hover:bg-neutral-900 hover:text-white"
              }`}
            >
              {option.text}
            </a>
          ))}
        </div>
      ))}

      <span className="text-[11px] text-neutral-600">
        Accounts with no scraped posts always sort last.
      </span>
    </div>
  );
}
