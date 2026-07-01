// Colored badge for an RBAC role. Reuses existing badge color classes.
const CLASS: Record<string, string> = {
  Admin: 'badge--pm',
  ProjectManager: 'badge--sa',
  User: 'badge--dev',
};

export function RoleBadge({ role }: { role: string }) {
  return <span className={`badge ${CLASS[role] ?? ''}`}>{role}</span>;
}
