// Project status badge: Hold = red, Completed = blue, Open/Cancel = plain text (no color).
const CLASS: Record<string, string> = { Hold: 'badge--red', Completed: 'badge--blue' };

export function StatusBadge({ status }: { status: string }) {
  const cls = CLASS[status];
  return cls ? <span className={`badge ${cls}`}>{status}</span> : <span>{status}</span>;
}
