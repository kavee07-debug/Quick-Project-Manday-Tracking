import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { PROJECT_TYPES, type CreateProjectsResult, type D365FetchResult, type D365StagingRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import './D365JobPage.scss';

export default function D365JobPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');

  const [rows, setRows] = useState<D365StagingRow[]>([]);
  const [maxCode, setMaxCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false); // drives the progress dialog
  const [fetchResult, setFetchResult] = useState<D365FetchResult | null>(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [editing, setEditing] = useState<D365StagingRow | null>(null);
  const [form, setForm] = useState({ jobNo: '', projectName: '', customerNo: '', customerName: '', type: '', revenue: '' });
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [rowsRes, maxRes] = await Promise.all([
        api.get<D365StagingRow[]>('/d365/staging'),
        api.get<{ code: string }>('/d365/max-project-code'),
      ]);
      setRows(rowsRes);
      setMaxCode(maxRes.code);
      setSelected(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  // Client-side filter across the visible fields.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.jobNo, r.projectName, r.customerNo, r.customerName, r.projectManagerCode]
        .some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.stagingId));
  const someVisibleSelected = filtered.some((r) => selected.has(r.stagingId));

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Select-all applies to the CURRENTLY FILTERED rows only.
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.stagingId));
      else filtered.forEach((r) => next.add(r.stagingId));
      return next;
    });
  }

  async function fetchFromBc() {
    setBusy(true);
    setFetching(true);
    setError(null);
    setFetchResult(null);
    try {
      setFetchResult(await api.post<D365FetchResult>('/d365/staging/fetch'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดึงข้อมูลจาก D365BC ไม่สำเร็จ');
    } finally {
      setFetching(false);
      setBusy(false);
    }
  }

  async function createOne(row: D365StagingRow) {
    if (!confirm(`สร้าง Project "${row.jobNo}" ?`)) return;
    try {
      await api.post(`/d365/staging/${row.stagingId}/create-project`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'สร้างไม่สำเร็จ');
    }
  }

  async function createEligible() {
    const eligible = rows.filter((r) => !r.alreadyExists).length;
    if (eligible === 0) return;
    if (!confirm(`สร้าง Project จากรายการที่ยังไม่ซ้ำทั้งหมด (${eligible} รายการ) ?`)) return;
    setBusy(true);
    try {
      const res = await api.post<CreateProjectsResult>('/d365/staging/create-eligible');
      await load();
      if (res.errors.length) alert(res.errors.join('\n'));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'สร้างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: D365StagingRow) {
    if (!confirm(`ลบรายการ "${row.jobNo}" ออกจาก staging ?`)) return;
    try {
      await api.del(`/d365/staging/${row.stagingId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`ลบรายการที่เลือก (${ids.length} รายการ) ออกจาก staging ?`)) return;
    setBusy(true);
    try {
      await api.post('/d365/staging/delete', { ids });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function openEdit(row: D365StagingRow) {
    setEditing(row);
    setForm({
      jobNo: row.jobNo,
      projectName: row.projectName ?? '',
      customerNo: row.customerNo ?? '',
      customerName: row.customerName ?? '',
      type: row.type ?? '',
      revenue: row.revenue == null ? '' : String(row.revenue),
    });
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setFormError(null);
    try {
      const payload = { ...form, revenue: form.revenue === '' ? null : Number(form.revenue) };
      await api.put(`/d365/staging/${editing.stagingId}`, payload);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  if (!isAdmin) return <p className="error-text">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</p>;

  const eligibleCount = rows.filter((r) => !r.alreadyExists).length;

  return (
    <div className="d365job">
      <div className="d365job__head">
        <h1>API Job — ดึง Project จาก D365BC</h1>
        <div className="d365job__actions">
          <button className="btn btn--primary" onClick={fetchFromBc} disabled={busy}>
            ⬇ ดึงข้อมูลจาก D365BC
          </button>
          <button className="btn" onClick={createEligible} disabled={busy || eligibleCount === 0}>
            + สร้างทั้งหมดที่ยังไม่ซ้ำ ({eligibleCount})
          </button>
          <button className="btn btn--danger" onClick={removeSelected} disabled={busy || selected.size === 0}>
            🗑 ลบที่เลือก ({selected.size})
          </button>
        </div>
      </div>

      <div className="d365job__banner card">
        ระบบจะดึง Project ที่มีเลข <b>มากกว่า</b>:{' '}
        <span className="d365job__maxcode">{maxCode || '—'}</span>
        <span className="muted"> (เลข Project SOJ ล่าสุดในระบบ)</span>
      </div>

      <div className="d365job__toolbar">
        <input
          className="input d365job__search"
          type="search"
          placeholder="ค้นหา (Job No / ชื่อ / ลูกค้า / PM)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted">
          แสดง {filtered.length} / {rows.length} รายการ
          {selected.size > 0 && ` · เลือก ${selected.size}`}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}

      {fetchResult && (
        <div className="d365job__result">
          <span className="badge badge--actual">เพิ่ม {fetchResult.inserted}</span>
          {fetchResult.updated > 0 && <span className="badge badge--budget">อัปเดต {fetchResult.updated}</span>}
          <span className="badge badge--adjust">พบทั้งหมด {fetchResult.fetched}</span>
          {fetchResult.errors.length > 0 && (
            <ul className="d365job__errors error-text">
              {fetchResult.errors.map((msg, i) => <li key={i}>{msg}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th className="d365job__check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                  onChange={toggleAllVisible}
                  disabled={filtered.length === 0}
                  title="เลือกทั้งหมด (ตามที่กรอง)"
                />
              </th>
              <th className="nowrap">Job No (Code)</th>
              <th>Project Name</th>
              <th>Customer</th>
              <th>ประเภท</th>
              <th className="num">Revenue</th>
              <th>PM</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="muted">กำลังโหลด…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="muted">ยังไม่มีรายการ — กด “ดึงข้อมูลจาก D365BC”</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="muted">ไม่พบรายการที่ค้นหา</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.stagingId} className={selected.has(r.stagingId) ? 'd365job__row--selected' : ''}>
                  <td className="d365job__check">
                    <input type="checkbox" checked={selected.has(r.stagingId)} onChange={() => toggleOne(r.stagingId)} />
                  </td>
                  <td className="nowrap">{r.jobNo}</td>
                  <td>{r.projectName ?? '—'}</td>
                  <td>{r.customerNo || r.customerName ? `${r.customerNo ?? ''}${r.customerName ? ' · ' + r.customerName : ''}` : '—'}</td>
                  <td>{r.type ?? '—'}</td>
                  <td className="num">{r.revenue != null ? r.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  <td>{r.projectManagerCode ?? '—'}</td>
                  <td>
                    {r.alreadyExists
                      ? <span className="badge badge--adjust">มีอยู่แล้ว</span>
                      : <span className="badge badge--green">ใหม่</span>}
                  </td>
                  <td className="num">
                    <span className="d365job__rowactions">
                      <button className="btn btn--sm" onClick={() => openEdit(r)}>แก้ไข</button>
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => createOne(r)}
                        disabled={r.alreadyExists}
                        title={r.alreadyExists ? 'มี Project code นี้อยู่แล้ว' : 'สร้างเป็น Project'}
                      >
                        สร้างเป็น Project
                      </button>
                      <button className="btn btn--sm btn--danger" onClick={() => remove(r)}>ลบ</button>
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {fetching && (
        <div className="d365job__overlay">
          <div className="d365job__progress card">
            <div className="d365job__spinner" />
            <div>
              <strong>กำลังดึงข้อมูลจาก D365BC…</strong>
              <p className="muted">ขอ Token → ดึง Job → ดึงชื่อ Project (อาจใช้เวลาสักครู่)</p>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Modal title="แก้ไขรายการ staging" onClose={() => setEditing(null)}>
          <form onSubmit={submit}>
            <label className="field-label">Job No (Code)</label>
            <input className="input" value={form.jobNo}
              onChange={(e) => setForm({ ...form, jobNo: e.target.value })} required />

            <label className="field-label">Project Name</label>
            <input className="input" value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })} />

            <label className="field-label">Customer No</label>
            <input className="input" value={form.customerNo}
              onChange={(e) => setForm({ ...form, customerNo: e.target.value })} />

            <label className="field-label">Customer Name</label>
            <input className="input" value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })} />

            <label className="field-label">ประเภท (Type)</label>
            <select className="input" value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="">— ไม่ระบุ —</option>
              {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="field-label">Revenue</label>
            <input className="input" type="number" step="0.01" min="0" value={form.revenue}
              onChange={(e) => setForm({ ...form, revenue: e.target.value })} />

            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
