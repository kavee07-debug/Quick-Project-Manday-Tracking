// Project status badge: Open = green, Cancel = red, Hold = orange, Completed = blue.
const CLASS: Record<string, string> = {
  Open: 'badge--green',
  Cancel: 'badge--red',
  Hold: 'badge--orange',
  Completed: 'badge--blue',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = CLASS[status];
  return cls ? <span className={`badge ${cls}`}>{status}</span> : <span>{status}</span>;
}
