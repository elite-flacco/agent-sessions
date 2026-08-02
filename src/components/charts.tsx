import { level } from "@/lib/format";

// Horizontal bar backed by the quantized `meter-fill-N` classes. `className`
// carries any modifier classes (e.g. `capability-meter is-skill`) and `title`
// the hover detail, since the meter span is the tooltip anchor at several call
// sites.
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
      <i className={`meter-fill-${level(value, max)}`} />
    </span>
  );
}

// Column of quantized `spark-fill-N` bars scaled to the largest present value.
// `slotTitle` supplies the per-column hover text where a call site wants it.
// Renders nothing when every value is null so callers can drop the wrapper.
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
          <i className={`spark-fill-${level(value ?? 0, max)}`} />
        </span>
      ))}
    </span>
  );
}
