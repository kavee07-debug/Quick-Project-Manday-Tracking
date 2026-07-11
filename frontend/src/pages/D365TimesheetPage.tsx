import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type {
  D365ApplyResult,
  D365TimesheetAutoMapResult,
  D365TimesheetFetchResult,
  D365TimesheetRow,
  Project,
  TaskItem,
  TimesheetValidateStatus,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import './D365JobPage.scss';

function fmt(n: number | null | undefined, digits = 2) {
  return n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function D365TimesheetPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');

  const [rows, setRows] = useState<D365TimesheetRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<D365TimesheetFetchResult | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [query, setQuery] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');   // '' = all; else a resourceNo
  const [statusFilter, setStatusFilter] = useState('');       // '' = all; else a timesheetStatus
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [editing, setEditing] = useState<D365TimesheetRow | null>(null);
  const [form, setForm] = useState({ newJobNo: '', newTaskNo: '' });
  const [editTasks, setEditTasks] = useState<TaskItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [jobQuery, setJobQuery] = useState('');   // search text for the New Job combobox
  const [jobOpen, setJobOpen] = useState(false);   // whether the combobox list is open

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<D365TimesheetRow[]>('/d365/timesheet'));
      setSelected(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    load();
    api.get<Project[]>('/projects').then(setProjects).catch(() => setProjects([]));
  }, [isAdmin]);

  const sameYear = startDate !== '' && endDate !== '' && startDate.slice(0, 4) === endDate.slice(0, 4);
  const validRange = startDate !== '' && endDate !== '' && endDate >= startDate;
  const canFetch = sameYear && validRange && !busy;
  const dateHint =
    startDate === '' || endDate === '' ? 'ระบุ Start/End Date ก่อนดึงข้อมูล'
    : !sameYear ? 'Start Date และ End Date ต้องเป็นปีเดียวกัน'
    : !validRange ? 'End Date ต้องไม่ก่อน Start Date'
    : null;

  // Distinct dropdown options built from the loaded rows.
  const resourceOptions = useMemo(() => {
    const m = new Map<string, string>();  // resourceNo -> "No · Name"
    rows.forEach((r) => {
      if (r.resourceNo) m.set(r.resourceNo, r.resourceName ? `${r.resourceNo} · ${r.resourceName}` : r.resourceNo);
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const statusOptions = useMemo(
    () => [...new Set(rows.map((r) => r.timesheetStatus).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (resourceFilter && r.resourceNo !== resourceFilter) return false;
      if (statusFilter && r.timesheetStatus !== statusFilter) return false;
      if (!q) return true;
      return [r.jobNo, r.jobTaskNo, r.resourceNo, r.resourceName, r.projectManager, r.newJobNo, r.newTaskNo, r.comment]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [rows, query, resourceFilter, statusFilter]);

  // Projects filtered by the New Job combobox search (matches code or name); capped for perf.
  const jobMatches = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    const list = q ? projects.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(q)) : projects;
    return list.slice(0, 50);
  }, [projects, jobQuery]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someVisibleSelected = filtered.some((r) => selected.has(r.id));

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function fetchFromBc() {
    if (!canFetch) return;
    setBusy(true); setFetching(true); setError(null); setFetchResult(null);
    try {
      const res = await api.post<D365TimesheetFetchResult>('/d365/timesheet/fetch', { startDate, endDate });
      setFetchResult(res);
      await load();
      if (res.errors.length) setError(res.errors.join(' · '));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดึงข้อมูลจาก D365BC ไม่สำเร็จ');
    } finally {
      setFetching(false); setBusy(false);
    }
  }

  async function loadTasksForCode(code: string) {
    const p = projects.find((x) => x.code.toLowerCase() === code.toLowerCase());
    if (!p) { setEditTasks([]); return; }
    try { setEditTasks(await api.get<TaskItem[]>(`/projects/${p.projectId}/tasks`)); }
    catch { setEditTasks([]); }
  }

  async function openEdit(row: D365TimesheetRow) {
    setEditing(row);
    setForm({ newJobNo: row.newJobNo ?? '', newTaskNo: row.newTaskNo ?? '' });
    setFormError(null);
    setEditTasks([]);
    setJobQuery(''); setJobOpen(false);
    if (row.newJobNo) await loadTasksForCode(row.newJobNo);
  }

  // Pick a project from the searchable New Job combobox (empty = clear).
  function selectJob(code: string) {
    setForm({ newJobNo: code, newTaskNo: '' });
    setJobOpen(false); setJobQuery('');
    if (code) loadTasksForCode(code); else setEditTasks([]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setFormError(null);
    try {
      await api.put(`/d365/timesheet/${editing.id}`, { newJobNo: form.newJobNo || null, newTaskNo: form.newTaskNo || null });
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(row: D365TimesheetRow) {
    if (!confirm(`ลบรายการ timesheet นี้ออกจาก staging ?`)) return;
    try { await api.del(`/d365/timesheet/${row.id}`); await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ'); }
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`ลบรายการที่เลือก (${ids.length}) ออกจาก staging ?`)) return;
    setBusy(true);
    try { await api.post('/d365/timesheet/delete', { ids }); await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  // Auto-map New Job No/Task for the selected rows via each project's Timesheet Mapping.
  async function autoMapSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await api.post<D365TimesheetAutoMapResult>('/d365/timesheet/auto-map', { ids });
      await load();
      alert(`Auto Mapping: จับคู่สำเร็จ ${res.mapped} รายการ · ไม่พบใน mapping ${res.unmatched} รายการ`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Auto Mapping ไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  async function applySelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Apply เป็น Actual manday (${ids.length} รายการ) ?`)) return;
    setBusy(true);
    try {
      const res = await api.post<D365ApplyResult>('/d365/timesheet/apply', { ids });
      await load();
      const msg = `Apply ${res.applied} รายการ · ข้าม ${res.skipped}`;
      alert(res.errors.length ? `${msg}\n${res.errors.join('\n')}` : msg);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Apply ไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  if (!isAdmin) return <p className="error-text">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</p>;

  // Validate result as an icon (no text): OK = ✅, ไม่พบ Job = ❌, ไม่พบ Task = ⚠️.
  const validateIcon = (s: TimesheetValidateStatus, label: string) => {
    const [icon, title] =
      s === 'OK' ? ['✅', `${label}: ตรงกับระบบ`]
      : s === 'NoJob' ? ['❌', `${label}: ไม่พบ Job ในระบบ`]
      : ['⚠️', `${label}: ไม่พบ Task ในระบบ`];
    return <span className="d365job__vicon" title={title}>{icon}</span>;
  };

  return (
    <div className="d365job">
      <div className="d365job__head">
        <h1>Timesheet — ดึงจาก D365BC</h1>
        <div className="d365job__actions">
          <label className="d365job__toggle">
            Start
            <input className="input" type="date" value={startDate} max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
          </label>
          <label className="d365job__toggle">
            End
            <input className="input" type="date" value={endDate} min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
          </label>
          <button className="btn btn--primary" onClick={fetchFromBc} disabled={!canFetch}>
            ⬇ ดึงข้อมูลจาก D365BC
          </button>
          <button className="btn" onClick={autoMapSelected} disabled={busy || selected.size === 0}
            title="จับคู่ New Job No/Task จาก Projects timesheet mapping">
            🔗 Auto Map New Job ({selected.size})
          </button>
          <button className="btn btn--primary" onClick={applySelected} disabled={busy || selected.size === 0}>
            ✓ Apply เป็น Actual ({selected.size})
          </button>
          <button className="btn btn--danger" onClick={removeSelected} disabled={busy || selected.size === 0}>
            🗑 ลบที่เลือก ({selected.size})
          </button>
        </div>
      </div>

      <div className="d365job__banner card">
        กรอง: ปีของ Start Date · ช่วง Start–End Date · Resource Group = <b>*CD*</b>
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Validate: <b>Vld. API</b> เช็ก Job No / Job Task (จาก API) · <b>Vld. New</b> เช็ก New Job No / New Task —
          {' '}✅ ตรงกับระบบ · ❌ ไม่พบ Job · ⚠️ ไม่พบ Task ·
          {' '}🟡⚠️ (ข้าง Job No) = SystemId นี้ลง Actual แล้ว · Apply ใช้ค่า New Job/New Task (Manday = Quantity MD)
          {' '}· รายการที่ Apply แล้วจะถูกลบออกจาก staging
        </div>
        {dateHint && <div className="error-text" style={{ marginTop: 'var(--space-2)' }}>{dateHint}</div>}
      </div>

      <div className="d365job__toolbar">
        <input className="input d365job__search" type="search"
          placeholder="ค้นหา (Job / Task / No. / PM / New)…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="d365job__toggle">
          Resource:
          <select className="input" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {resourceOptions.map(([no, label]) => <option key={no} value={no}>{label}</option>)}
          </select>
        </label>
        <label className="d365job__toggle">
          Status:
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="muted">
          แสดง {filtered.length} / {rows.length} รายการ{selected.size > 0 && ` · เลือก ${selected.size}`}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}

      {fetchResult && (
        <div className="d365job__result">
          <span className="badge badge--actual">เพิ่ม {fetchResult.inserted}</span>
          {fetchResult.updated > 0 && <span className="badge badge--budget">อัปเดต {fetchResult.updated}</span>}
          <span className="badge badge--adjust">พบทั้งหมด {fetchResult.fetched}</span>
          <span className="muted"> (ปี {fetchResult.year})</span>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th className="nowrap center" title="Validate Job No / Job Task (จาก API)">Vld. API</th>
              <th className="d365job__check">
                <input type="checkbox" checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                  onChange={toggleAllVisible} disabled={filtered.length === 0} />
              </th>
              <th className="nowrap">Job No</th>
              <th className="nowrap">Job Task No</th>
              <th className="nowrap">Date</th>
              <th>No.</th>
              <th>Resource Name</th>
              <th className="num">Qty (hr)</th>
              <th className="num">Qty MD</th>
              <th>Comment</th>
              <th>PM</th>
              <th>Timesheet Status</th>
              <th className="nowrap center" title="Validate New Job No / New Task">Vld. New</th>
              <th className="nowrap" title="คลิกเพื่อแก้ไข New Job / New Task">New Job No</th>
              <th className="nowrap">New Task No</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="muted">กำลังโหลด…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={16} className="muted">ยังไม่มีรายการ — เลือกช่วงวันที่แล้วกด “ดึงข้อมูลจาก D365BC”</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={16} className="muted">ไม่พบรายการที่ค้นหา</td></tr>
            ) : (
              filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr className={selected.has(r.id) ? 'd365job__row--selected' : ''}>
                    <td className="center">{validateIcon(r.validateStatus, 'API Job/Task')}</td>
                    <td className="d365job__check">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                    </td>
                    <td className="nowrap">
                      {r.jobNo ?? '—'}
                      {r.alreadyInActual && <span className="d365job__ma" title="SystemId นี้ลง Actual แล้ว">⚠️</span>}
                    </td>
                    <td className="nowrap">{r.jobTaskNo ?? '—'}</td>
                    <td className="nowrap">{r.timesheetDate ?? '—'}</td>
                    <td>{r.resourceNo ?? '—'}</td>
                    <td>{r.resourceName ?? '—'}</td>
                    <td className="num">{fmt(r.quantityHour)}</td>
                    <td className="num">{fmt(r.quantityMD, 4)}</td>
                    <td>{r.comment || '—'}</td>
                    <td>{r.projectManager ?? '—'}</td>
                    <td>{r.timesheetStatus ?? '—'}</td>
                    <td className="center">{validateIcon(r.validateNewStatus, 'New Job/Task')}</td>
                    <td className="nowrap">
                      <button type="button" className="d365job__linkcell" title="คลิกเพื่อแก้ไข New Job / New Task"
                        onClick={() => openEdit(r)}>
                        {r.newJobNo ?? '— แก้ไข —'}
                      </button>
                    </td>
                    <td className="nowrap">{r.newTaskNo ?? '—'}</td>
                    <td className="num">
                      <button className="btn btn--sm btn--danger btn--icon" title="ลบออกจาก staging"
                        onClick={() => remove(r)}>🗑</button>
                    </td>
                  </tr>
                </Fragment>
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
              <strong>กำลังดึง Timesheet จาก D365BC…</strong>
              <p className="muted">ขอ Token → ดึง entitySetTimesheettoPowerBI (อาจใช้เวลาสักครู่)</p>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Modal title="แก้ไข New Job / New Task" onClose={() => setEditing(null)}>
          <form onSubmit={submit}>
            <p className="muted">API: {editing.jobNo ?? '—'} / {editing.jobTaskNo ?? '—'}</p>

            <label className="field-label">New Job No (Project)</label>
            {(() => {
              const sel = projects.find((p) => p.code.toLowerCase() === form.newJobNo.toLowerCase());
              const selLabel = !form.newJobNo ? ''
                : sel ? `${sel.code} · ${sel.name}`
                : `${form.newJobNo} (เดิม — ไม่พบในระบบ)`;
              return (
                <div className="d365job__combo">
                  <input className="input" placeholder="ค้นหา Job / Project (รหัส หรือ ชื่อ)…"
                    value={jobOpen ? jobQuery : selLabel}
                    onFocus={() => { setJobOpen(true); setJobQuery(''); }}
                    onChange={(e) => { setJobQuery(e.target.value); setJobOpen(true); }}
                    onBlur={() => setTimeout(() => setJobOpen(false), 150)} />
                  {jobOpen && (
                    <ul className="d365job__combolist">
                      <li className="muted" onMouseDown={() => selectJob('')}>— ไม่ระบุ —</li>
                      {jobMatches.map((p) => (
                        <li key={p.projectId} onMouseDown={() => selectJob(p.code)}>
                          <b>{p.code}</b> · {p.name}
                        </li>
                      ))}
                      {jobMatches.length === 0 && <li className="muted">ไม่พบ Project ที่ค้นหา</li>}
                    </ul>
                  )}
                </div>
              );
            })()}
            {form.newJobNo && !projects.some((p) => p.code.toLowerCase() === form.newJobNo.toLowerCase()) && (
              <p className="muted">ค่าเดิม “{form.newJobNo}” ไม่พบใน Project — เลือกใหม่จากรายการด้านบน</p>
            )}

            <label className="field-label">New Task No (Task)</label>
            <select className="input" value={form.newTaskNo}
              onChange={(e) => setForm({ ...form, newTaskNo: e.target.value })} disabled={!form.newJobNo}>
              <option value="">— ไม่ระบุ —</option>
              {/* Keep the current (possibly unknown) task value visible if it isn't in the loaded task list. */}
              {form.newTaskNo && !editTasks.some((t) => t.name.toLowerCase() === form.newTaskNo.toLowerCase()) && (
                <option value={form.newTaskNo}>{form.newTaskNo} (เดิม — ไม่พบในระบบ)</option>
              )}
              {editTasks.map((t) => (
                <option key={t.taskId} value={t.name}>
                  {t.name}{t.description ? ` — ${t.description}` : ''}
                </option>
              ))}
            </select>
            {/* Show the selected task's description under the dropdown. */}
            {(() => {
              const sel = editTasks.find((t) => t.name.toLowerCase() === form.newTaskNo.toLowerCase());
              return sel?.description
                ? <p className="muted">Task Description: {sel.description}</p>
                : null;
            })()}

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
