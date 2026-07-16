// Task status badge: Open = green, InProgress = orange, Done = blue.
const CLASS: Record<string, string> = {
  Open: 'badge--green',
  InProgress: 'badge--orange',
  Done: 'badge--blue',
};

export function TaskStatusBadge({ status }: { status: string }) {
  const cls = CLASS[status];
  return cls ? <span className={`badge ${cls}`}>{status}</span> : <span>{status}</span>;
}
