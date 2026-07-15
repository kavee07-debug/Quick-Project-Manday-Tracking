import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PROJECT_TYPES, type MeetingLine, type MeetingLineEdit, type MeetingRecord, type MeetingRecordUpsert, type Project, type Resource } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { MeetingHeaderFields } from '../components/MeetingHeaderFields';
import { StatusBadge } from '../components/StatusBadge';
import './MeetingPage.scss';

const emptyForm = (): MeetingRecordUpsert => ({
  meetingDate: '', topic: '', notes: '',
  agenda: null, attendees: null, preparedBy: null, certifiedBy: null,
  nextMeetingDate: null, nextMeetingPreparedBy: null, otherTopics: null,
});

// Build an upsert payload from the loaded meeting (used when saving one part, e.g. Other Topics).
function toUpsert(m: MeetingRecord): MeetingRecordUpsert {
  return {
    meetingDate: m.meetingDate, topic: m.topic, notes: m.notes ?? null,
    agenda: m.agenda ?? null, attendees: m.attendees ?? null,
    preparedBy: m.preparedBy ?? null, certifiedBy: m.certifiedBy ?? null,
    nextMeetingDate: m.nextMeetingDate ?? null, nextMeetingPreparedBy: m.nextMeetingPreparedBy ?? null,
    otherTopics: m.otherTopics ?? null,
  };
}

type SortKey = 'project' | 'customer' | 'type' | 'status' | 'progress';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

// Type → chip colour class (Internal/Other = neutral grey).
const TYPE_CHIP: Record<string, string> = {
  Implement: 'badge--blue', Customize: 'badge--orange', Training: 'badge--purple', Internal: '', Other: '',
};

function lineSortValue(l: MeetingLine, key: SortKey): string | number | null {
  switch (key) {
    case 'project': return l.projectCode;
    case 'customer': return l.customerName ?? null;
    case 'type': return l.projectType ?? null;
    case 'status': return l.statusSnapshot ?? null;
    case 'progress': return l.progressSnapshot ?? null;
  }
}

export default function MeetingDetailPage() {
  const { id } = useParams();
  const meetingId = Number(id);
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [lines, setLines] = useState<MeetingLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Header edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<MeetingRecordUpsert>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  // Per-line edit modal (Update Detail / Next Action)
  const [editingLine, setEditingLine] = useState<MeetingLine | null>(null);
  const [lineForm, setLineForm] = useState<{ updateDetail: string; nextAction: string }>({ updateDetail: '', nextAction: '' });
  const [lineError, setLineError] = useState<string | null>(null);

  // Add-project combobox
  const [projQuery, setProjQuery] = useState('');
  const [projOpen, setProjOpen] = useState(false);

  // Column sort (null = keep saved SortOrder)
  const [sort, setSort] = useState<Sort | null>(null);

  // Search (project/customer) + multi-select type filter
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());

  // "สรุปการประชุมอื่นๆ" — free-text, edited via popup (like the per-line Update Detail)
  const [showOtherEdit, setShowOtherEdit] = useState(false);
  const [otherForm, setOtherForm] = useState('');
  const [otherErr, setOtherErr] = useState<string | null>(null);

  const loadLines = useCallback(async () => {
    setLines(await api.get<MeetingLine[]>(`/meetings/${meetingId}/lines`));
  }, [meetingId]);

  const loadAll = useCallback(async () => {
    try {
      const [m] = await Promise.all([api.get<MeetingRecord>(`/meetings/${meetingId}`), loadLines()]);
      setMeeting(m);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, [meetingId, loadLines]);

  useEffect(() => {
    loadAll();
    api.get<Project[]>('/projects').then(setProjects).catch(() => {/* picker is best-effort */});
    api.get<Resource[]>('/resources').then(setResources).catch(() => {/* dropdown is best-effort */});
  }, [loadAll]);

  if (!hasRole('Admin', 'ProjectManager')) return <p className="muted">เฉพาะ Admin / Project Manager เท่านั้น</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!meeting) return <p className="muted">กำลังโหลด…</p>;

  const closed = meeting.isClosed;

  // Projects not yet on this meeting, filtered by the combobox query (capped for perf).
  const addedIds = new Set(lines.map((l) => l.projectId));
  const projMatches = (() => {
    const q = projQuery.trim().toLowerCase();
    const list = projects.filter((p) => !addedIds.has(p.projectId));
    const matched = q ? list.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(q)) : list;
    return matched.slice(0, 50);
  })();

  function openLineEdit(l: MeetingLine) {
    setEditingLine(l);
    setLineForm({ updateDetail: l.updateDetail ?? '', nextAction: l.nextAction ?? '' });
    setLineError(null);
  }

  // Save one line's Update Detail / Next Action from the popup, then persist immediately.
  async function submitLineEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingLine) return;
    setLineError(null);
    const updateDetail = lineForm.updateDetail.trim() === '' ? null : lineForm.updateDetail;
    const nextAction = lineForm.nextAction.trim() === '' ? null : lineForm.nextAction;
    const updated = lines.map((l) =>
      l.meetingLineId === editingLine.meetingLineId ? { ...l, updateDetail, nextAction } : l,
    );
    try {
      const payload: MeetingLineEdit[] = updated.map((l) => ({
        meetingLineId: l.meetingLineId,
        updateDetail: l.updateDetail ?? null,
        nextAction: l.nextAction ?? null,
        sortOrder: l.sortOrder,
      }));
      await api.put(`/meetings/${meetingId}/lines`, payload);
      setLines(updated);
      setEditingLine(null);
    } catch (err) {
      setLineError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  function openEdit() {
    setForm(toUpsert(meeting!));
    setFormError(null);
    setShowEdit(true);
  }

  function openOtherEdit() {
    setOtherForm(meeting!.otherTopics ?? '');
    setOtherErr(null);
    setShowOtherEdit(true);
  }

  // Save the free-text "other topics" back onto the meeting header.
  async function submitOtherEdit(e: FormEvent) {
    e.preventDefault();
    if (!meeting) return;
    setOtherErr(null);
    try {
      const payload = { ...toUpsert(meeting), otherTopics: otherForm.trim() === '' ? null : otherForm };
      const updated = await api.put<MeetingRecord>(`/meetings/${meetingId}`, payload);
      setMeeting(updated);
      setShowOtherEdit(false);
    } catch (err) {
      setOtherErr(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const updated = await api.put<MeetingRecord>(`/meetings/${meetingId}`, form);
      setMeeting(updated);
      setShowEdit(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function closeMeeting() {
    if (!confirm('ปิดการประชุมนี้? เมื่อปิดแล้วจะแก้ไขไม่ได้จนกว่าจะ Reopen')) return;
    try {
      setMeeting(await api.post<MeetingRecord>(`/meetings/${meetingId}/close`, {}));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ปิดการประชุมไม่สำเร็จ');
    }
  }

  async function reopenMeeting() {
    try {
      setMeeting(await api.post<MeetingRecord>(`/meetings/${meetingId}/reopen`, {}));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'เปิดการประชุมไม่สำเร็จ');
    }
  }

  async function loadProjects() {
    setBusy(true);
    try {
      const res = await api.post<{ created: number; updated: number }>(`/meetings/${meetingId}/load-projects`, {});
      await loadLines();
      alert(`โหลด project แล้ว: เพิ่มใหม่ ${res.created} · อัปเดตสถานะ ${res.updated} (Update Detail / Next Action คงเดิม)`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'โหลด project ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function addProject(projectId: number) {
    setProjOpen(false);
    setProjQuery('');
    try {
      await api.post(`/meetings/${meetingId}/lines`, { projectId });
      await loadLines();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'เพิ่ม project ไม่สำเร็จ');
    }
  }

  async function removeLine(l: MeetingLine) {
    if (!confirm(`ลบ ${l.projectCode} ออกจากการประชุมนี้?`)) return;
    try {
      await api.del(`/meeting-lines/${l.meetingLineId}`);
      await loadLines();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur && cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  }
  function toggleType(t: string) {
    setTypeFilter((cur) => {
      const next = new Set(cur);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  // Type counts for the chips — from all lines, unaffected by the current filter.
  const typeCounts: Record<string, number> = {};
  for (const t of PROJECT_TYPES) typeCounts[t] = 0;
  for (const l of lines) if (l.projectType) typeCounts[l.projectType] = (typeCounts[l.projectType] ?? 0) + 1;

  // Filter by search text (project/customer) + selected types, then sort.
  const q = query.trim().toLowerCase();
  const filteredLines = lines.filter((l) => {
    const matchQ = !q || `${l.projectCode} ${l.projectName} ${l.customerName ?? ''}`.toLowerCase().includes(q);
    const matchType = typeFilter.size === 0 || (l.projectType != null && typeFilter.has(l.projectType));
    return matchQ && matchType;
  });

  // Display order: sorted by the clicked column, else the saved SortOrder. Edits still target lines by id.
  const sortedLines = (() => {
    if (!sort) return filteredLines;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...filteredLines].sort((a, b) => {
      const va = lineSortValue(a, sort.key);
      const vb = lineSortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;   // nulls last
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * factor;
    });
  })();

  const SORT_COLS: { key: SortKey; label: string; num?: boolean }[] = [
    { key: 'project', label: 'Project' },
    { key: 'customer', label: 'Customer' },
    { key: 'type', label: 'ประเภท' },
    { key: 'status', label: 'สถานะ' },
    { key: 'progress', label: 'Progress', num: true },
  ];

  return (
    <div className="detail meeting">
      <div className="detail__breadcrumb muted">
        <Link to="/meeting-record">Meeting Record</Link> / {meeting.meetingDate}
      </div>
      <div className="section-head">
        <h1 className="detail__title" style={{ marginBottom: 0 }}>
          {meeting.topic}
          {closed && <span className="badge badge--green" style={{ marginLeft: 'var(--space-3)', verticalAlign: 'middle' }}>ปิดแล้ว</span>}
        </h1>
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
          <button className="btn btn--sm" onClick={() => navigate(`/meeting-record/${meetingId}/print`)}>🖨 พิมพ์รายงาน</button>
          {!closed && <button className="btn btn--sm" onClick={openEdit}>แก้ไขหัวข้อ</button>}
          {closed
            ? <button className="btn btn--sm btn--navy" onClick={reopenMeeting}>Reopen</button>
            : <button className="btn btn--sm btn--primary" onClick={closeMeeting}>Close Meeting</button>}
        </span>
      </div>
      <p className="muted meeting__hint">
        วันที่ {meeting.meetingDate}{meeting.notes ? ` · ${meeting.notes}` : ''}
        {closed && meeting.closedBy && ` · ปิดโดย ${meeting.closedBy}${meeting.closedAt ? ` (${meeting.closedAt.slice(0, 10)})` : ''}`}
      </p>

      {closed ? (
        <p className="muted meeting__hint">การประชุมถูกปิดแล้ว — แก้ไขไม่ได้ (กด Reopen เพื่อแก้ไข)</p>
      ) : (
        <div className="meeting__toolbar">
          <button className="btn btn--primary" onClick={loadProjects} disabled={busy}
            title="ดึง project สถานะ Open/Hold — เพิ่มรายการใหม่ และรีเฟรชสถานะของที่มีอยู่ (Update Detail / Next Action คงเดิม)">
            โหลด Project
          </button>
          <div className="combo meeting__addproj">
            <input className="input" placeholder="+ เพิ่ม project (ค้นหา รหัส หรือ ชื่อ)…"
              value={projQuery}
              onFocus={() => setProjOpen(true)}
              onChange={(e) => { setProjQuery(e.target.value); setProjOpen(true); }}
              onBlur={() => setTimeout(() => setProjOpen(false), 150)} />
            {projOpen && (
              <ul className="combo__list">
                {projMatches.map((p) => (
                  <li key={p.projectId} onMouseDown={() => addProject(p.projectId)}>
                    <b>{p.code}</b> · {p.name} <span className="muted">({p.status})</span>
                  </li>
                ))}
                {projMatches.length === 0 && <li className="muted">ไม่พบ project ที่จะเพิ่ม</li>}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="meeting__filterbar">
        <input className="input meeting__search" type="search" placeholder="ค้นหา Project / Customer…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="muted">ประเภท:</span>
        {PROJECT_TYPES.map((t) => {
          const active = typeFilter.has(t);
          return (
            <button key={t} type="button"
              className={`status-chip ${TYPE_CHIP[t] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active} onClick={() => toggleType(t)}>
              <span className="status-chip__name">{t}</span>
              <span className="status-chip__count">{typeCounts[t] ?? 0}</span>
            </button>
          );
        })}
        {typeFilter.size > 0 && (
          <button type="button" className="btn btn--sm" onClick={() => setTypeFilter(new Set())}>ล้างตัวกรอง</button>
        )}
      </div>

      <div className="card">
        <table className="table meeting__table">
          <thead>
            <tr>
              {SORT_COLS.map((c) => {
                const active = sort?.key === c.key;
                const cls = ['sortable', c.num ? 'num' : '', active ? 'sorted' : ''].filter(Boolean).join(' ');
                return (
                  <th key={c.key} className={cls} onClick={() => toggleSort(c.key)}
                      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {c.label}
                    <span className="sort-ind">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </th>
                );
              })}
              <th>Update Detail</th>
              <th>Next Action</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.length === 0 ? (
              <tr><td colSpan={8} className="muted">
                {lines.length === 0 ? 'ยังไม่มี project — กด "โหลด Project" หรือเพิ่มทีละรายการ' : 'ไม่พบรายการตามเงื่อนไข'}
              </td></tr>
            ) : (
              sortedLines.map((l) => (
                <tr key={l.meetingLineId}>
                  <td className="meeting__projcell">
                    <strong>{l.projectCode}</strong>
                    <span className="muted"> {l.projectName}</span>
                  </td>
                  <td className="nowrap">{l.customerName ?? '—'}</td>
                  <td>{l.projectType ?? '—'}</td>
                  <td>{l.statusSnapshot ? <StatusBadge status={l.statusSnapshot} /> : '—'}</td>
                  <td className="num">{l.progressSnapshot != null ? `${l.progressSnapshot}%` : '—'}</td>
                  <td className="meeting__notecell">
                    {l.updateDetail ? l.updateDetail : <span className="muted">—</span>}
                  </td>
                  <td className="meeting__notecell">
                    {l.nextAction ? l.nextAction : <span className="muted">—</span>}
                  </td>
                  <td className="num nowrap">
                    {!closed && (
                      <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn--sm" onClick={() => openLineEdit(l)}>edit</button>
                        <button className="btn btn--sm btn--danger" onClick={() => removeLine(l)}>ลบ</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* สรุปการประชุมอื่นๆ (Internal) — free-text, edited via popup */}
      <div className="section-head" style={{ marginTop: 'var(--space-5)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>สรุปการประชุมอื่นๆ (Internal)</h2>
        {!closed && <button className="btn btn--sm" onClick={openOtherEdit}>edit</button>}
      </div>
      <div className="card meeting__notecell" style={{ padding: 'var(--space-4)', maxWidth: 'none' }}>
        {meeting.otherTopics ? meeting.otherTopics : <span className="muted">— ไม่มีหัวข้ออื่นๆ —</span>}
      </div>

      {showEdit && (
        <Modal title="แก้ไขหัวข้อการประชุม" onClose={() => setShowEdit(false)}>
          <form onSubmit={submitEdit}>
            <MeetingHeaderFields form={form} setForm={setForm} resources={resources} />

            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowEdit(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {showOtherEdit && (
        <Modal title="สรุปการประชุมอื่นๆ (Internal)" onClose={() => setShowOtherEdit(false)}>
          <form onSubmit={submitOtherEdit}>
            <label className="field-label">รายละเอียด (พิมพ์ยาว / ขึ้นบรรทัดใหม่ได้)</label>
            <textarea className="input meeting__editbox" rows={12} autoFocus
              value={otherForm}
              onChange={(e) => setOtherForm(e.target.value)} />

            {otherErr && <p className="error-text">{otherErr}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowOtherEdit(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {editingLine && (
        <Modal title={`แก้ไข: ${editingLine.projectCode} · ${editingLine.projectName}`} onClose={() => setEditingLine(null)}>
          <form onSubmit={submitLineEdit}>
            <label className="field-label">Update Detail</label>
            <textarea className="input meeting__editbox" rows={8} autoFocus
              value={lineForm.updateDetail}
              onChange={(e) => setLineForm({ ...lineForm, updateDetail: e.target.value })} />

            <label className="field-label">Next Action</label>
            <textarea className="input meeting__editbox" rows={8}
              value={lineForm.nextAction}
              onChange={(e) => setLineForm({ ...lineForm, nextAction: e.target.value })} />

            {lineError && <p className="error-text">{lineError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditingLine(null)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
