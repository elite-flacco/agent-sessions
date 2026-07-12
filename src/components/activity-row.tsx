import {
  AlertTriangle,
  Check,
  CircleDot,
  Clock3,
  Code2,
  Command,
  FileCode2,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";

const icons: Record<string, ReactNode> = {
  started: <CircleDot size={14} />,
  tool: <Command size={14} />,
  file: <FileCode2 size={14} />,
  command: <TerminalSquare size={14} />,
  completed: <Check size={14} />,
  warning: <AlertTriangle size={14} />,
  info: <Code2 size={14} />,
};

export function ActivityRow({
  event,
}: {
  event: {
    kind: string;
    title: string;
    detail: string | null;
    occurredAt: string;
  };
}) {
  return (
    <article className="activity-row">
      <div className="event-icon">
        {icons[event.kind] ?? <Clock3 size={14} />}
      </div>
      <div>
        <strong>{event.title}</strong>
        {event.detail && <p>{event.detail}</p>}
      </div>
      <time>
        {new Date(event.occurredAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    </article>
  );
}
