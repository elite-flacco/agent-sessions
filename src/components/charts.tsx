import { level } from "@/lib/format";

// Horizontal bar. `className` carries any modifier classes (e.g.
// `capability-meter is-skill`) and `title` the hover detail, since the meter
// span is the tooltip anchor at several call sites. The fill width is derived
// inline from `level()` (0, or 10–100%); the track, color, and shape come from
// the `.meter` / `.meter i` rules in globals.css.
export function Meter({
  value,
  max,
  className,
  title,
}: {
  value: number;
  max: number;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={className ? `meter ${className}` : "meter"}
      aria-hidden
      title={title}
    >
      <i style={{ width: `${level(value, max) * 10}%` }} />
    </span>
  );
}

// Column of bars scaled to the largest present value. `slotTitle` supplies the
// per-column hover text where a call site wants it. Renders nothing when every
// value is null so callers can drop the wrapper. Fill heights are derived inline
// from `level()`; track, color, and shape come from `.spark` / `.spark-slot` /
// `.spark-slot i` in globals.css.
export function Sparkline({
  values,
  label,
  className,
  slotTitle,
}: {
  values: (number | null)[];
  label: string;
  className?: string;
  slotTitle?: (index: number) => string;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const max = Math.max(...present, 0);

  return (
    <span
      className={className ? `spark ${className}` : "spark"}
      role="img"
      aria-label={label}
    >
      {values.map((value, index) => (
        <span className="spark-slot" key={index} title={slotTitle?.(index)}>
          <i style={{ height: `${level(value ?? 0, max) * 10}%` }} />
        </span>
      ))}
    </span>
  );
}
