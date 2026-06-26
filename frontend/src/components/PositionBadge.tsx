// Colored badge for a resource Position: Dev=blue, SA=green, PM=orange.
const CLASS: Record<string, string> = { Dev: 'badge--dev', SA: 'badge--sa', PM: 'badge--pm' };

export function PositionBadge({ position }: { position?: string | null }) {
  if (!position) return <span className="muted">—</span>;
  const cls = CLASS[position] ?? '';
  return <span className={`badge ${cls}`}>{position}</span>;
}
