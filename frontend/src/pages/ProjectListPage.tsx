import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PROJECT_STATUSES, PROJECT_TYPES, type Project, type ProjectUpsert } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { ImportExportBar } from '../components/ImportExportBar';
import { StatusBadge } from '../components/StatusBadge';
import './ProjectListPage.scss';

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const empty: ProjectUpsert = {
  code: '',
  name: '',
  description: '',
  type: 'Implement',
  status: 'Open',
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      type: p.type ?? '',
      status: p.status,
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
            + เพิ่มโปรเจกต์
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
              <th className="nowrap">รหัส</th>
              <th>ชื่อ</th>
              <th>ประเภท</th>
              <th>สถานะ</th>
              <th className="num">Revenue</th>
              <th className="num">Sum Budget</th>
              <th className="num">Sum Adjust</th>
              <th className="num">Sum Actual</th>
              <th className="num">คงเหลือ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="muted">กำลังโหลด…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="muted">{query ? 'ไม่พบโปรเจกต์ที่ค้นหา' : 'ยังไม่มีโปรเจกต์'}</td></tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.projectId}>
                  <td className="nowrap">
                    <a onClick={() => navigate(`/projects/${p.projectId}`)} style={{ cursor: 'pointer' }}>
                      {p.code}
                    </a>
                  </td>
                  <td>{p.name}</td>
                  <td>{p.type ?? '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
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
