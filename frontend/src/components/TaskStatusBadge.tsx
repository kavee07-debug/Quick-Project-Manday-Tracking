// Task status badge: Open = blue, InProgress = orange, Done = green.
const CLASS: Record<string, string> = {
  Open: 'badge--blue',
  InProgress: 'badge--orange',
  Done: 'badge--green',
};

export function TaskStatusBadge({ status }: { status: string }) {
  const cls = CLASS[status];
  return cls ? <span className={`badge ${cls}`}>{status}</span> : <span>{status}</span>;
}
