import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { PROJECT_STATUSES, PROJECT_TYPES, type MandaySummaryRow, type Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { PivotSummaryTable, type PivotRow } from '../components/PivotSummaryTable';
import './MandaySummaryPage.scss';

// Status/type → chip colour class (shared badge modifiers). Internal/Other = neutral grey dot.
const STATUS_CHIP: Record<string, string> = {
  Open: 'badge--green',
  Hold: 'badge--orange',
  Completed: 'badge--blue',
  Cancel: 'badge--red',
};
const TYPE_CHIP: Record<string, string> = {
  Implement: 'badge--blue',
  Customize: 'badge--orange',
  Training: 'badge--purple',
  Internal: '',
  Other: '',
};

export default function MandaySummaryPage() {
  const { hasRole } = useAuth();
  const [rows, setRows] = useState<MandaySummaryRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chip selections (empty set for a group = show all of that group).
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  // Chip counts come from the full project population, unaffected by chip selection.
  useEffect(() => {
    api.get<Project[]>('/projects').then(setProjects).catch(() => {/* counts are best-effort */});
  }, []);
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of PROJECT_STATUSES) c[s] = 0;
    for (const p of projects) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [projects]);
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of PROJECT_TYPES) c[t] = 0;
    for (const p of projects) if (p.type) c[p.type] = (c[p.type] ?? 0) + 1;
    return c;
  }, [projects]);

  // (Re)load the pivot whenever the filter changes.
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter.size > 0) params.set('statuses', [...statusFilter].join(','));
    if (typeFilter.size > 0) params.set('types', [...typeFilter].join(','));
    const qs = params.toString();
    api
      .get<MandaySummaryRow[]>(`/manday-summary${qs ? `?${qs}` : ''}`)
      .then((r) => { setRows(r); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [statusFilter, typeFilter]);

  function toggle(setFilter: typeof setStatusFilter, value: string) {
    setFilter((cur) => {
      const next = new Set(cur);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  const pivotRows: PivotRow[] = rows.map((r) => ({
    key: r.projectId,
    firstCell: (
      <>
        <strong>{r.code}</strong>
        <span className="muted msummary__projname"> {r.name}</span>
        <span className="msummary__status"><StatusBadge status={r.status} /></span>
      </>
    ),
    cells: r.cells,
  }));

  return (
    <div className="msummary">
      <h1 className="msummary__title">Manday Summary</h1>
      <p className="muted msummary__hint">
        สรุป manday แยกตามตำแหน่ง (Position) ของ resource ต่อโปรเจกต์ · Remaining = (Budget+Adjust) − Actual
      </p>

      <div className="msummary__filterbar">
        <span className="msummary__filterbar-label">สถานะ:</span>
        {PROJECT_STATUSES.map((s) => {
          const active = statusFilter.has(s);
          return (
            <button
              key={s}
              type="button"
              className={`status-chip ${STATUS_CHIP[s] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              title={active ? `คลิกอีกครั้งเพื่อยกเลิกกรอง ${s}` : `กรองเฉพาะ ${s}`}
              onClick={() => toggle(setStatusFilter, s)}
            >
              <span className="status-chip__name">{s}</span>
              <span className="status-chip__count">{statusCounts[s] ?? 0}</span>
            </button>
          );
        })}

        <span className="msummary__filterbar-sep" aria-hidden="true" />

        <span className="msummary__filterbar-label">ประเภท:</span>
        {PROJECT_TYPES.map((t) => {
          const active = typeFilter.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`status-chip ${TYPE_CHIP[t] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              title={active ? `คลิกอีกครั้งเพื่อยกเลิกกรอง ${t}` : `กรองเฉพาะ ${t}`}
              onClick={() => toggle(setTypeFilter, t)}
            >
              <span className="status-chip__name">{t}</span>
              <span className="status-chip__count">{typeCounts[t] ?? 0}</span>
            </button>
          );
        })}
        {(statusFilter.size > 0 || typeFilter.size > 0) && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => { setStatusFilter(new Set()); setTypeFilter(new Set()); }}
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <PivotSummaryTable firstColHeader="Project" rows={pivotRows} isAdmin={hasRole('Admin')} />
      )}
    </div>
  );
}
