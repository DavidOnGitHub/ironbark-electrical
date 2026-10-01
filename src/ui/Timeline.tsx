import { formatRelativeTime } from "@kabosh-digital/m-street-kit/format";

export interface TimelineEvent {
  id: string;
  summary: string;
  body: string | null;
  actorLabel: string | null;
  at: Date;
  kind?: string;
}

/** The history list used on every detail page. */
export function Timeline({ events, empty = "Nothing yet." }: { events: TimelineEvent[]; empty?: string }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="flex flex-col gap-3 text-sm">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <p className={e.kind === "NOTE" ? "font-medium" : ""}>{e.summary}</p>
          {e.body ? <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.body}</p> : null}
          <p className="text-xs text-muted-foreground">
            {e.actorLabel} - {formatRelativeTime(e.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}
