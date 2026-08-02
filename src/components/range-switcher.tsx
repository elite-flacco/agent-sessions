"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { OverviewRange } from "@/lib/queries";

const RANGES: { value: OverviewRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

// Segmented 7d/30d toggle backed by the `?range=` URL param. The 7-day view is
// the default, so it is expressed by removing the param rather than persisting
// it. Shared by Overview and Insights, which both read the same param.
export function RangeSwitcher({
  range,
  ariaLabel,
}: {
  range: OverviewRange;
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectRange(next: OverviewRange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "7d") params.delete("range");
    else params.set("range", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <div className="overview-range" aria-label={ariaLabel}>
      {RANGES.map(({ value, label }) => (
        <button
          key={value}
          className={`btn ${range === value ? "btn-accent" : "btn-outline"}`}
          type="button"
          aria-pressed={range === value}
          onClick={() => selectRange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
