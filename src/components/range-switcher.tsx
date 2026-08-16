"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { OverviewRange } from "@/lib/queries";

const RANGES: { value: OverviewRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

// Segmented range control backed by the `?range=` URL param. The 7-day view is
// the default, so it is expressed by removing the param rather than persisting
// it. A null range supports contextual states such as Sessions' Today deep link
// without falsely marking one of the regular options as selected.
export function RangeSwitcher({
  range,
  ariaLabel,
}: {
  range: OverviewRange | null;
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
