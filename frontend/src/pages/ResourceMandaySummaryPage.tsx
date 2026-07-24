import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { PROJECT_STATUSES, PROJECT_TYPES, type Project, type ResourceBreakdownRow, type ResourceMandaySummaryRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PivotSummaryTable, type ExplainCtx, type PivotRow } from '../components/PivotSummaryTable';
import { JobFilter } from '../components/JobFilter';
import { BreakdownTable } from '../components/BreakdownTable';
import './MandaySummaryPage.scss';

const STATUS_CHIP: Record<string, string> = {
  Open: 'badge--green', Hold: 'badge--orange', Completed: 'badge--blue', Cancel: 'badge--red',
};
const TYPE_CHIP: Record<string, string> = {
  Implement: 'badge--blue', Customize: 'badge--orange', Training: 'badge--purple', Internal: '', Other: '',
};

export default function ResourceMandaySummaryPage() {
  const { hasRole } = useAuth();
  const [rows, setRows] = useState<ResourceMandaySummaryRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [breakdown, setBreakdown] = useState<ResourceBreakdownRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [jobFilter, setJobFilter] = useState<Set<string>>(new Set());

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

  // Query string shared by the pivot + breakdown fetches.
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter.size > 0) params.set('statuses', [...statusFilter].join(','));
    if (typeFilter.size > 0) params.set('types', [...typeFilter].join(','));
    if (jobFilter.size > 0) params.set('jobs', [...jobFilter].join(','));
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [statusFilter, typeFilter, jobFilter]);

  // (Re)load pivot + breakdown whenever the filter changes.
  useEffect(() => {
    Promise.all([
      api.get<ResourceMandaySummaryRow[]>(`/resource-manday-summary${qs}`),
      api.get<ResourceBreakdownRow[]>(`/resource-manday-summary/breakdown${qs}`),
    ])
      .then(([r, b]) => { setRows(r); setBreakdown(b); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [qs]);

  function toggle(setFilter: typeof setStatusFilter, value: string) {
    setFilter((cur) => {
      const next = new Set(cur);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  function renderDetail({ rowKey, position }: ExplainCtx) {
    const items = breakdown.filter((b) =>
      (rowKey == null || b.resourceId === Number(rowKey)) &&
      (position == null || b.position === position));
    const resLabel = rowKey == null ? 'ทุก Resource' : (rows.find((r) => String(r.resourceId) === rowKey)?.name ?? rowKey);
    const posLabel = position == null ? 'ทุกตำแหน่ง' : position;
    return (
      <div className="msummary__detail">
        <div className="msummary__detail-head">ที่มา: {resLabel} · {posLabel}</div>
        <BreakdownTable rows={items} maxHeight="40vh" accent />
      </div>
    );
  }

  const pivotRows: PivotRow[] = rows.map((r) => ({
    key: String(r.resourceId),
    firstCell: (
      <>
        <strong>{r.code}</strong>
        <span className="muted msummary__projname"> {r.name}</span>
      </>
    ),
    cells: r.cells,
  }));

  return (
    <div className="msummary">
      <h1 className="msummary__title">Resource Manday Summary</h1>
      <p className="muted msummary__hint">
        สรุป manday แยกตาม resource (วางในกลุ่มตำแหน่งของตนเอง) · Remaining = (Budget+Adjust) − Actual · คลิกที่ยอดเพื่อดูที่มา
      </p>

      <div className="msummary__filterbar">
        <span className="msummary__filterbar-label">สถานะ:</span>
        {PROJECT_STATUSES.map((s) => {
          const active = statusFilter.has(s);
          return (
            <button key={s} type="button"
              className={`status-chip ${STATUS_CHIP[s] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active} onClick={() => toggle(setStatusFilter, s)}>
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
            <button key={t} type="button"
              className={`status-chip ${TYPE_CHIP[t] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active} onClick={() => toggle(setTypeFilter, t)}>
              <span className="status-chip__name">{t}</span>
              <span className="status-chip__count">{typeCounts[t] ?? 0}</span>
            </button>
          );
        })}

        <span className="msummary__filterbar-sep" aria-hidden="true" />

        <JobFilter projects={projects} selected={jobFilter} onChange={setJobFilter} />

        {(statusFilter.size > 0 || typeFilter.size > 0 || jobFilter.size > 0) && (
          <button type="button" className="btn btn--sm"
            onClick={() => { setStatusFilter(new Set()); setTypeFilter(new Set()); setJobFilter(new Set()); }}>
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <PivotSummaryTable firstColHeader="Resource" rows={pivotRows} isAdmin={hasRole('Admin')} renderDetail={renderDetail} />
      )}
    </div>
  );
}
