import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
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
  const [jobNoInput, setJobNoInput] = useState('');
  const [revenueFilter, setRevenueFilter] = useState<'all' | 'zero' | 'nonzero'>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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

  // Client-side filter across the visible fields (+ optional Revenue = 0 / > 0 filter).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const rev = r.revenue ?? 0;
      if (revenueFilter === 'zero' && rev !== 0) return false;
      if (revenueFilter === 'nonzero' && rev === 0) return false;
      if (!q) return true;
      return [r.jobNo, r.projectName, r.customerNo, r.customerName, r.projectManagerCode]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [rows, query, revenueFilter]);

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

  async function fetchByJob() {
    const jobNo = jobNoInput.trim();
    if (!jobNo) return;
    setBusy(true);
    setFetching(true);
    setError(null);
    setFetchResult(null);
    try {
      const res = await api.post<D365FetchResult>('/d365/staging/fetch-by-job', { jobNo });
      setFetchResult(res);
      await load();
      if (res.errors.length) setError(res.errors.join(' · '));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดึง Job ไม่สำเร็จ');
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

  async function updateOne(row: D365StagingRow) {
    if (!confirm(`อัพเดทข้อมูล (พร้อม Task) ไปยัง Project "${row.jobNo}" ที่มีอยู่แล้ว ?`)) return;
    try {
      await api.post(`/d365/staging/${row.stagingId}/update-project`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'อัพเดทไม่สำเร็จ');
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

  async function createSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`สร้าง Project จากรายการที่เลือก (${ids.length} รายการ) ?`)) return;
    setBusy(true);
    try {
      const res = await api.post<CreateProjectsResult>('/d365/staging/create-selected', { ids });
      await load();
      if (res.errors.length) alert(res.errors.join('\n'));
      else if (res.skipped > 0) alert(`สร้าง ${res.created} รายการ · ข้าม ${res.skipped} (ซ้ำ)`);
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
          <span className="d365job__byjob">
            <input
              className="input"
              placeholder="เลข Job (เช่น SOJ2606-0105)"
              value={jobNoInput}
              onChange={(e) => setJobNoInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchByJob(); }}
              disabled={busy}
            />
            <button className="btn" onClick={fetchByJob} disabled={busy || !jobNoInput.trim()}>
              ⬇ ดึง Job นี้
            </button>
          </span>
          <button className="btn" onClick={createEligible} disabled={busy || eligibleCount === 0}>
            + สร้างทั้งหมดที่ยังไม่ซ้ำ ({eligibleCount})
          </button>
          <button className="btn btn--primary" onClick={createSelected} disabled={busy || selected.size === 0}>
            + สร้างที่เลือก ({selected.size})
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
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Revenue คำนวณอัตโนมัติจาก jobPlanningLines (เฉพาะ Billable + หมวด IMPLEMENT/CUSTOMIZE/MA) —
          ควรกด “ดึงจาก D365BC” ที่หน้า <b>Master Item</b> ก่อน ไม่งั้น Revenue จะเป็น 0.
          {' '}⚠️ = มี Task หมวด MA · 🪪 = ทุก Task เป็นหมวด LICENSE
        </div>
      </div>

      <div className="d365job__toolbar">
        <input
          className="input d365job__search"
          type="search"
          placeholder="ค้นหา (Job No / ชื่อ / ลูกค้า / PM)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="d365job__toggle">
          Revenue:
          <select
            className="input"
            value={revenueFilter}
            onChange={(e) => setRevenueFilter(e.target.value as 'all' | 'zero' | 'nonzero')}
          >
            <option value="all">ทั้งหมด</option>
            <option value="zero">= 0 (ตรวจก่อนลบ)</option>
            <option value="nonzero">&gt; 0</option>
          </select>
        </label>
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
              filtered.map((r) => {
                const hasMa = r.tasks.some((t) => (t.itemCategoryCode ?? '').toUpperCase() === 'MA');
                const allLicense = r.tasks.length > 0
                  && r.tasks.every((t) => (t.itemCategoryCode ?? '').toUpperCase() === 'LICENSE');
                return (
                <Fragment key={r.stagingId}>
                <tr className={selected.has(r.stagingId) ? 'd365job__row--selected' : ''}>
                  <td className="d365job__check">
                    <input type="checkbox" checked={selected.has(r.stagingId)} onChange={() => toggleOne(r.stagingId)} />
                  </td>
                  <td className="nowrap">
                    <button
                      className="d365job__expand"
                      onClick={() => toggleExpand(r.stagingId)}
                      disabled={r.tasks.length === 0}
                      title={r.tasks.length ? 'ดู Task' : 'ไม่มี Task'}
                    >
                      {expanded.has(r.stagingId) ? '▾' : '▸'} {r.tasks.length}
                    </button>{' '}
                    {r.jobNo}
                    {hasMa && (
                      <span className="d365job__ma" title="มี Task หมวด MA">⚠️</span>
                    )}
                    {allLicense && (
                      <span className="d365job__lic" title="ทุก Task เป็นหมวด LICENSE">🪪</span>
                    )}
                  </td>
                  <td>{r.projectName ?? '—'}</td>
                  <td>{r.customerNo || r.customerName ? `${r.customerNo ?? ''}${r.customerName ? ' · ' + r.customerName : ''}` : '—'}</td>
                  <td>{r.type ?? '—'}</td>
                  <td className={`num${hasMa ? ' d365job__revenue--ma' : ''}`}>{r.revenue != null ? r.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  <td>{r.projectManagerCode ?? '—'}</td>
                  <td>
                    {r.alreadyExists
                      ? <span className="badge badge--adjust">มีอยู่แล้ว</span>
                      : <span className="badge badge--green">ใหม่</span>}
                  </td>
                  <td className="num">
                    <span className="d365job__rowactions">
                      <button className="btn btn--sm" onClick={() => openEdit(r)}>แก้ไข</button>
                      {r.alreadyExists ? (
                        <button
                          className="btn btn--sm btn--primary"
                          onClick={() => updateOne(r)}
                          title="อัพเดทข้อมูล + Task ไปยัง Project ที่มีอยู่แล้ว"
                        >
                          อัพเดท Project
                        </button>
                      ) : (
                        <button
                          className="btn btn--sm btn--primary"
                          onClick={() => createOne(r)}
                          title="สร้างเป็น Project"
                        >
                          สร้างเป็น Project
                        </button>
                      )}
                      <button className="btn btn--sm btn--danger" onClick={() => remove(r)}>ลบ</button>
                    </span>
                  </td>
                </tr>
                {expanded.has(r.stagingId) && r.tasks.length > 0 && (
                  <tr className="d365job__subrow">
                    <td></td>
                    <td colSpan={8}>
                      <div className="d365job__tasks">
                        <div className="d365job__tasks-title">Task ({r.tasks.length})</div>
                        <table className="d365job__subtable">
                          <thead>
                            <tr><th className="nowrap">Task No</th><th>Task Description</th><th className="nowrap">Item Category</th><th className="num">Revenue</th></tr>
                          </thead>
                          <tbody>
                            {r.tasks.map((t) => (
                              <tr key={t.taskStagingId}>
                                <td className="nowrap">{t.taskNo}</td>
                                <td>{t.taskDescription ?? '—'}</td>
                                <td className="nowrap">{t.itemCategoryCode ?? '—'}</td>
                                <td className="num">{t.revenue != null ? t.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })
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
              <p className="muted">ขอ Token → ดึง Job → ชื่อ Project → jobPlanningLines (Revenue) (อาจใช้เวลาสักครู่)</p>
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
