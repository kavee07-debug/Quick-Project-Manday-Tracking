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

const empty: ProjectUpsert = {
  code: '',
  name: '',
  description: '',
  customerId: null,
  type: 'Implement',
  status: 'Open',
  progress: null,
  revenue: null,
  startDate: null,
  endDate: null,
};

export default function ProjectListPage() {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

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

  const filtered = useMemo(
    () =>
      query
        ? projects.filter(
            (p) => p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query),
          )
        : projects,
    [projects, query],
  );

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
        <ImportExportBar
          exportPath="/export/projects"
          exportFilename="projects.xlsx"
          importPath="/import/projects"
          canImport={isManager}
          onImported={load}
        />
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
              <tr><td colSpan={12} className="muted">{query ? 'ไม่พบโปรเจกต์ที่ค้นหา' : 'ยังไม่มีโปรเจกต์'}</td></tr>
            ) : (
              sorted.map((p) => (
                <tr key={p.projectId}>
                  <td className="nowrap">
                    <a onClick={() => navigate(`/projects/${p.projectId}`)} style={{ cursor: 'pointer' }}>
                      {p.code}
                    </a>
                  </td>
                  <td>{p.name}</td>
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

      {showForm && (
        <Modal title={editing ? 'แก้ไขโปรเจกต์' : 'เพิ่มโปรเจกต์'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">รหัสโปรเจกต์</label>
            <input className="input" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })} required />

            <label className="field-label">ชื่อ</label>
            <input className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required />

            <label className="field-label">รายละเอียด</label>
            <input className="input" value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />

            <label className="field-label">ลูกค้า (Customer)</label>
            <select className="input" value={form.customerId ?? ''}
              onChange={(e) => setForm({ ...form, customerId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">— ไม่ระบุ —</option>
              {customers.map((c) => (
                <option key={c.customerId} value={c.customerId}>{c.code} · {c.name}</option>
              ))}
            </select>

            <label className="field-label">ประเภท (Type)</label>
            <select className="input" value={form.type ?? ''}
              onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="field-label">สถานะ (Status)</label>
            <select className="input" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <label className="field-label">Progress (%)</label>
            <input className="input" type="number" step="0.01" min="0" max="100" value={form.progress ?? ''}
              onChange={(e) => setForm({ ...form, progress: e.target.value === '' ? null : Number(e.target.value) })} />

            <label className="field-label">มูลค่าโครงการ (Revenue)</label>
            <input className="input" type="number" step="0.01" min="0" value={form.revenue ?? ''}
              onChange={(e) => setForm({ ...form, revenue: e.target.value === '' ? null : Number(e.target.value) })} />

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
