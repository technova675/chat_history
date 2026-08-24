/**
 * Instant loading skeleton for /users. The page is force-dynamic and pages
 * through several Supabase tables, so the first visit / refresh would
 * otherwise sit on a blank screen until every query resolves.
 */
function CardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
      <div className="h-3 w-28 rounded bg-neutral-900" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-11 w-11 shrink-0 rounded-full bg-neutral-900" />
          <div className="flex flex-col gap-2">
            <div className="h-4 w-32 rounded bg-neutral-900" />
            <div className="h-3 w-20 rounded bg-neutral-900" />
          </div>
        </div>
        <div className="h-8 w-20 shrink-0 rounded-lg bg-neutral-900" />
      </div>

      <div className="flex min-h-[3.9rem] flex-col gap-2">
        <div className="h-3 w-full rounded bg-neutral-900" />
        <div className="h-3 w-11/12 rounded bg-neutral-900" />
        <div className="h-3 w-2/3 rounded bg-neutral-900" />
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-neutral-800 pt-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-5 w-12 rounded bg-neutral-900" />
            <div className="h-2.5 w-16 rounded bg-neutral-900" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-neutral-900" />
        <div className="h-8 w-8 rounded-full bg-neutral-900" />
        <div className="h-8 w-24 rounded-lg bg-neutral-900" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <main className="min-h-screen bg-black px-6 py-12">
      <div
        className="mx-auto flex w-full max-w-[1600px] animate-pulse flex-col gap-8"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">Loading tracked accounts…</span>

        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="h-7 w-52 rounded bg-neutral-900" />
              <div className="h-4 w-72 rounded bg-neutral-900" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-9 w-24 rounded-lg bg-neutral-900" />
              <div className="h-11 w-56 rounded-xl bg-neutral-900" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 w-28 rounded-full bg-neutral-900" />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-3 border-y border-neutral-900 py-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-baseline gap-2">
                <div className="h-2.5 w-20 rounded bg-neutral-900" />
                <div className="h-4 w-12 rounded bg-neutral-900" />
              </div>
            ))}
          </div>
        </header>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
