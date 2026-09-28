import {
  BACKFILL_NOTE,
  FINISHED_RULE,
  MINUTES_RULE,
  STATS_WEEKS,
  WEEKS_RULE,
  backlogLine,
  barPercent,
  weekLabel,
  type StatsTotals,
  type StatsWeek,
} from "@/lib/stats";

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span
        aria-hidden="true"
        className="hidden h-2 w-24 overflow-hidden rounded-sm bg-edge sm:block"
      >
        <span
          className="block h-full bg-ink-dim"
          style={{ width: `${barPercent(value, max)}%` }}
        />
      </span>
      <span className="w-6 tabular-nums">{value}</span>
    </span>
  );
}

export function StatsView({
  weeks,
  totals,
}: {
  weeks: StatsWeek[];
  totals: StatsTotals;
}) {
  const heading = (
    <div className="my-6 flex items-center justify-between gap-3">
      <h1 className="text-xl font-medium">Reading stats</h1>
      <a href="/inbox" className="text-sm text-ink-dim underline">
        Back to library
      </a>
    </div>
  );
  if (totals.saved === 0)
    return (
      <>
        {heading}
        <p className="py-12 text-center text-ink-dim">
          Nothing saved yet. Save an article, and your weeks start here.
        </p>
      </>
    );
  // Saved and finished share one scale, so their bars compare.
  const max = Math.max(0, ...weeks.flatMap((w) => [w.saved, w.finished]));
  return (
    <>
      {heading}
      <dl className="grid grid-cols-3 gap-3">
        {(
          [
            ["In your library", totals.library],
            ["Finished", totals.finished],
            ["Backlog", totals.backlog],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-edge p-3">
            <dt className="text-xs text-ink-dim">{label}</dt>
            <dd className="text-2xl tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-ink-dim">{backlogLine(totals.backlog)}</p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="mb-2 text-left text-ink-dim">
            The last {STATS_WEEKS} weeks
          </caption>
          <thead>
            <tr className="border-b border-edge text-xs text-ink-dim">
              <th scope="col" className="py-2 text-left font-normal">
                Week
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Saved
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Finished
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Minutes
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Highlights
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, position) => (
              <tr key={week.weekStart} className="border-b border-edge">
                <th scope="row" className="py-2 text-left font-normal">
                  <time dateTime={week.weekStart}>
                    {weekLabel(week.weekStart, position)}
                  </time>
                </th>
                <td className="py-2">
                  <Bar value={week.saved} max={max} />
                </td>
                <td className="py-2">
                  <Bar value={week.finished} max={max} />
                </td>
                <td className="py-2 text-right tabular-nums">
                  {week.finished === 0 ? (
                    // reading_stats has no minutes for a week with nothing
                    // finished; that is none, not unknown.
                    "0"
                  ) : week.minutes === null ? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">not known</span>
                    </>
                  ) : (
                    `about ${week.minutes}`
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {week.highlights}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-1 text-xs text-ink-dim">
        <p>{FINISHED_RULE}</p>
        <p>{MINUTES_RULE}</p>
        <p>{WEEKS_RULE}</p>
        <p>{BACKFILL_NOTE}</p>
      </div>
    </>
  );
}
