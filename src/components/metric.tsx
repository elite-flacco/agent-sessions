import { CircleDot } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

interface MetricProps {
  label: string;
  value: string;
  /** Supporting line under the value; renders as the trailing note span. */
  note?: ReactNode;
  /** Turns the tile into an internal link (`.metric-link`). */
  href?: string;
  /** Marks the note as live/positive state (`.metric-accent` + dot). */
  accent?: boolean;
  /** The value is prose rather than a figure (`.metric-textual`). */
  textual?: boolean;
  /** Extra classes for the value element (e.g. "mono"). */
  valueClassName?: string;
}

/**
 * Summary tile shared by the sessions dashboard, overview, usage, insights,
 * and project briefings. The child order (eyebrow, strong, optional trailing
 * note span) is load-bearing: globals.css targets `.metric > strong` and
 * `.metric > span:last-child`.
 */
export function Metric({
  label,
  value,
  note,
  href,
  accent,
  textual,
  valueClassName,
}: MetricProps) {
  const className = [
    "metric",
    href ? "metric-link" : undefined,
    textual ? "metric-textual" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      <span className="eyebrow">{label}</span>
      <strong className={valueClassName} title={textual ? value : undefined}>
        {value}
      </strong>
      {note !== undefined && (
        <span className={accent ? "metric-accent" : undefined}>
          {accent && <CircleDot size={10} />}
          {note}
        </span>
      )}
    </>
  );
  return href ? (
    <Link className={className} href={href}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
