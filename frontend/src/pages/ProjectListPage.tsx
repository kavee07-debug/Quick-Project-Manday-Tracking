import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  type Customer,
  type Project,
  type ProjectUpsert,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { ProjectFormFields } from '../components/ProjectFormFields';
import { ImportExportBar } from '../components/ImportExportBar';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import './ProjectListPage.scss';

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// #7 — "New Project" button label follows the browser language (no full i18n framework yet).
const newProjectLabel = navigator.language.toLowerCase().startsWith('th')
  ? '+ เพิ่มโปรเจกต์'
  : '+ New Project';

type SortKey =
  | 'code' | 'name' | 'customer' | 'type' | 'status' | 'progress'
  | 'revenue' | 'totalBudget' | 'totalAdjust' | 'totalActual' | 'remaining';

// Table columns in display order. `num` right-aligns; the actions column is not sortable.
const COLUMNS: { key: SortKey; label: string; num?: boolean; nowrap?: boolean; minWidth?: number }[] = [
  { key: 'code', label: 'รหัส', nowrap: true },
  { key: 'name', label: 'ชื่อ' },
  { key: 'customer', label: 'ลูกค้า' },
  { key: 'type', label: 'ประเภท' },
  { key: 'status', label: 'สถานะ' },
  { key: 'progress', label: 'Progress', minWidth: 160 },
  { key: 'revenue', label: 'Revenue', num: true },
  { key: 'totalBudget', label: 'Sum Budget', num: true },
  { key: 'totalAdjust', label: 'Sum Adjust', num: true },
  { key: 'totalActual', label: 'Sum Actual', num: true },
  { key: 'remaining', label: 'คงเหลือ', num: true },
];

function sortValue(p: Project, key: SortKey): string | number | null {
  switch (key) {
    case 'code': return p.code;
    case 'name': return p.name;
    case 'customer': return p.customerName ?? null;
    case 'type': return p.type ?? null;
    case 'status': return p.status;
    case 'progress': return p.progress ?? null;
    case 'revenue': return p.revenue ?? null;
    case 'totalBudget': return p.totalBudget;
    case 'totalAdjust': return p.totalAdjust;
    case 'totalActual': return p.totalActual;
    case 'remaining': return p.remaining;
  }
}

const PAGE_SIZES = [20, 30, 50, 100] as const;

// Status → badge modifier class (mirrors StatusBadge), used for the summary/filter chips.
const STATUS_CHIP: Record<string, string> = {
  Open: 'badge--green',
  Hold: 'badge--orange',
  Completed: 'badge--blue',
  Cancel: 'badge--red',
};

// Type → chip color class (reuses the shared badge modifiers for the type filter chips).
const TYPE_CHIP: Record<string, string> = {
  Implement: 'badge--blue',
  Customize: 'badge--orange',
  Training: 'badge--purple',
  Other: '',
};

const empty: ProjectUpsert = {
  code: '',
  name: '',
  description: '',
  customerId: null,
  type: 'Implement',
  status: 'Open',
  progress: null,
  revenue: null,
  timesheetMapping: null,
  trainingDate: null,
  startDate: null,
  endDate: null,
};

export default function ProjectListPage() {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawQuery = searchParams.get('q') ?? '';
  const query = rawQuery.trim().toLowerCase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectUpsert>(empty);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.get<Project[]>('/projects'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Active customers for the project form dropdown.
    api.get<Customer[]>('/customers').then(setCustomers).catch(() => setCustomers([]));
  }, []);

  // Search filter first (status chips count against this set, unaffected by status selection).
  const searched = useMemo(
    () =>
      query
        ? projects.filter(
            (p) => p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query),
          )
        : projects,
    [projects, query],
  );

  // Count per status / type for the filter chips (counted against the search set, unaffected by chip selection).
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of PROJECT_STATUSES) counts[s] = 0;
    for (const p of searched) counts[p.status] = (counts[p.status] ?? 0) + 1;
    return counts;
  }, [searched]);
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of PROJECT_TYPES) counts[t] = 0;
    for (const p of searched) if (p.type) counts[p.type] = (counts[p.type] ?? 0) + 1;
    return counts;
  }, [searched]);

  // Then apply the status- and type-chip selections (empty selection = show all for that group).
  const filtered = useMemo(() => {
    let list = searched;
    if (statusFilter.size > 0) list = list.filter((p) => statusFilter.has(p.status));
    if (typeFilter.size > 0) list = list.filter((p) => p.type != null && typeFilter.has(p.type));
    return list;
  }, [searched, statusFilter, typeFilter]);

  function toggleFrom(setFilter: typeof setStatusFilter, value: string) {
    setFilter((cur) => {
      const next = new Set(cur);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }
  const toggleStatus = (s: string) => toggleFrom(setStatusFilter, s);
  const toggleType = (t: string) => toggleFrom(setTypeFilter, t);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls last regardless of direction
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor;
    });
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur && cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }

  // Reset to the first page whenever the result set or page size changes.
  useEffect(() => {
    setPage(1);
  }, [query, sort, pageSize, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Pagination controls, shown both above (in the status row) and below the table.
  const renderPager = (extra = '') => (
    <div className={`projects__pager ${extra}`.trim()}>
      <label className="projects__pager-size">
        แสดง
        <select className="input" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        ต่อหน้า · ทั้งหมด {sorted.length} รายการ
      </label>
      <div className="projects__pager-nav">
        <button className="btn btn--sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          ‹ ก่อนหน้า
        </button>
        <span className="muted">หน้า {currentPage} / {totalPages}</span>
        <button className="btn btn--sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
          ถัดไป ›
        </button>
      </div>
    </div>
  );

  const kpi = useMemo(
    () =>
      filtered.reduce(
        (a, p) => ({
          revenue: a.revenue + (p.revenue ?? 0),
          budget: a.budget + p.totalBudget,
          remaining: a.remaining + p.remaining,
        }),
        { revenue: 0, budget: 0, remaining: 0 },
      ),
    [filtered],
  );

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(p: Project) {
    setEditing(p);
    setForm({
      code: p.code,
      name: p.name,
      description: p.description ?? '',
      customerId: p.customerId ?? null,
      type: p.type ?? '',
      status: p.status,
      progress: p.progress ?? null,
      revenue: p.revenue ?? null,
      timesheetMapping: p.timesheetMapping ?? null,
      trainingDate: p.trainingDate ?? null,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
    });
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      if (editing) await api.put(`/projects/${editing.projectId}`, form);
      else await api.post('/projects', form);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(p: Project) {
    if (!confirm(`ลบโปรเจกต์ ${p.code}? (ข้อมูล task และ manday จะถูกลบด้วย)`)) return;
    try {
      await api.del(`/projects/${p.projectId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div className="projects">
      <div className="projects__head">
        <h1>Projects{query && <span className="muted"> · ค้นหา “{query}”</span>}</h1>
        {isManager && (
          <button className="btn btn--primary" onClick={openCreate}>
            {newProjectLabel}
          </button>
        )}
      </div>

      <div className="kpi-grid projects__kpi">
        <div className="statcard statcard--navy">
          <div className="statcard__label">จำนวนโปรเจกต์</div>
          <div className="statcard__value">{filtered.length}</div>
        </div>
        <div className="statcard statcard--teal">
          <div className="statcard__label">มูลค่ารวม (Revenue)</div>
          <div className="statcard__value">{money(kpi.revenue)}</div>
        </div>
        <div className="statcard statcard--blue">
          <div className="statcard__label">Budget รวม</div>
          <div className="statcard__value">{fmt(kpi.budget)}</div>
        </div>
        <div className={`statcard ${kpi.remaining < 0 ? 'statcard--red' : 'statcard--green'}`}>
          <div className="statcard__label">คงเหลือรวม</div>
          <div className="statcard__value">{fmt(kpi.remaining)}</div>
        </div>
      </div>

      <div className="projects__toolbar">
        <input
          className="input projects__search"
          type="search"
          placeholder="ค้นหาโปรเจกต์ (รหัส/ชื่อ)…"
          value={rawQuery}
          onChange={(e) => {
            const v = e.target.value;
            setSearchParams(v ? { q: v } : {}, { replace: true });
          }}
        />
        <ImportExportBar
          exportPath="/export/projects"
          exportFilename="projects.xlsx"
          importPath="/import/projects"
          canImport={isManager}
          onImported={load}
        />
      </div>

      <div className="projects__statusbar">
        <span className="projects__statusbar-label">สถานะ:</span>
        {PROJECT_STATUSES.map((s) => {
          const active = statusFilter.has(s);
          return (
            <button
              key={s}
              type="button"
              className={`status-chip ${STATUS_CHIP[s] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              title={active ? `คลิกอีกครั้งเพื่อยกเลิกกรอง ${s}` : `กรองเฉพาะ ${s}`}
              onClick={() => toggleStatus(s)}
            >
              <span className="status-chip__name">{s}</span>
              <span className="status-chip__count">{statusCounts[s] ?? 0}</span>
            </button>
          );
        })}
        {statusFilter.size > 0 && (
          <button type="button" className="btn btn--sm projects__statusbar-clear" onClick={() => setStatusFilter(new Set())}>
            ล้างตัวกรอง
          </button>
        )}

        <span className="projects__statusbar-sep" aria-hidden="true" />

        <span className="projects__statusbar-label">ประเภท:</span>
        {PROJECT_TYPES.map((t) => {
          const active = typeFilter.has(t);
          return (
            <button
              key={t}
              type="button"
              className={`status-chip ${TYPE_CHIP[t] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              title={active ? `คลิกอีกครั้งเพื่อยกเลิกกรอง ${t}` : `กรองเฉพาะ ${t}`}
              onClick={() => toggleType(t)}
            >
              <span className="status-chip__name">{t}</span>
              <span className="status-chip__count">{typeCounts[t] ?? 0}</span>
            </button>
          );
        })}
        {typeFilter.size > 0 && (
          <button type="button" className="btn btn--sm projects__statusbar-clear" onClick={() => setTypeFilter(new Set())}>
            ล้างตัวกรอง
          </button>
        )}
        {!loading && sorted.length > 0 && renderPager('projects__pager--top')}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort?.key === c.key;
                const cls = ['sortable', c.num ? 'num' : '', c.nowrap ? 'nowrap' : '', active ? 'sorted' : '']
                  .filter(Boolean).join(' ');
                return (
                  <th key={c.key} className={cls} style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                      onClick={() => toggleSort(c.key)} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {c.label}
                    <span className="sort-ind">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </th>
                );
              })}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="muted">กำลังโหลด…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={12} className="muted">{query || statusFilter.size > 0 || typeFilter.size > 0 ? 'ไม่พบโปรเจกต์ตามเงื่อนไข' : 'ยังไม่มีโปรเจกต์'}</td></tr>
            ) : (
              paged.map((p) => (
                <tr key={p.projectId}>
                  <td className="nowrap">
                    <a onClick={() => navigate(`/projects/${p.projectId}`)} style={{ cursor: 'pointer' }}>
                      {p.code}
                    </a>
                    {p.code.toUpperCase().startsWith('SOJ') && p.totalBudget === 0 && p.totalAdjust === 0 && (
                      <span className="projects__new" title="ยังไม่กำหนด Budget/Adjust — คลิกที่รหัสเพื่อไปกำหนด">🆕</span>
                    )}
                  </td>
                  <td>
                    {p.name}
                    {p.type === 'Training' && p.trainingDate && (
                      <span className="projects__training"> {p.trainingDate}</span>
                    )}
                  </td>
                  <td>{p.customerName ? `${p.customerCode} · ${p.customerName}` : '—'}</td>
                  <td>{p.type ?? '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td><ProgressBar value={p.progress} /></td>
                  <td className="num">{p.revenue != null ? fmt(p.revenue) : '—'}</td>
                  <td className="num">{fmt(p.totalBudget)}</td>
                  <td className="num">{fmt(p.totalAdjust)}</td>
                  <td className="num">{fmt(p.totalActual)}</td>
                  <td className={`num ${p.remaining < 0 ? 'over-budget' : ''}`}>{fmt(p.remaining)}</td>
                  <td className="num">
                    {isManager && (
                      <span className="projects__actions">
                        <button className="btn btn--sm" onClick={() => openEdit(p)}>แก้ไข</button>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(p)}>ลบ</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && sorted.length > 0 && renderPager()}

      {showForm && (
        <Modal title={editing ? 'แก้ไขโปรเจกต์' : 'เพิ่มโปรเจกต์'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <ProjectFormFields form={form} setForm={setForm} customers={customers} />

            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
