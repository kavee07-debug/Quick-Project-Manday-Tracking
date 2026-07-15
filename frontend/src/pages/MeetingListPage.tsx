import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { MeetingRecord, MeetingRecordUpsert, MeetingSetting, Resource } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { MeetingHeaderFields } from '../components/MeetingHeaderFields';
import './MeetingPage.scss';

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (): MeetingRecordUpsert => ({
  meetingDate: today(), topic: '', notes: '',
  agenda: null, attendees: null, preparedBy: null, certifiedBy: null,
  nextMeetingDate: null, nextMeetingPreparedBy: null, otherTopics: null,
});

export default function MeetingListPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MeetingRecord[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [settings, setSettings] = useState<MeetingSetting>({});
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<MeetingRecordUpsert>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  // "ตั้งค่า Default" modal
  const [showSetup, setShowSetup] = useState(false);
  const [setupForm, setSetupForm] = useState<MeetingSetting>({});
  const [setupError, setSetupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<MeetingRecord[]>('/meetings'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, []);

  useEffect(() => {
    load();
    api.get<Resource[]>('/resources').then(setResources).catch(() => {/* dropdown is best-effort */});
    api.get<MeetingSetting>('/meetings/settings').then(setSettings).catch(() => {/* defaults optional */});
  }, [load]);

  if (!hasRole('Admin', 'ProjectManager')) return <p className="muted">เฉพาะ Admin / Project Manager เท่านั้น</p>;

  function openCreate() {
    // Prefill from the configured defaults; date = today, topic left blank.
    setForm({
      ...emptyForm(),
      agenda: settings.defaultAgenda ?? null,
      attendees: settings.defaultAttendees ?? null,
      preparedBy: settings.defaultPreparedBy ?? null,
    });
    setFormError(null);
    setShowForm(true);
  }

  function openSetup() {
    setSetupForm({ ...settings });
    setSetupError(null);
    setShowSetup(true);
  }

  async function submitSetup(e: FormEvent) {
    e.preventDefault();
    setSetupError(null);
    try {
      const saved = await api.put<MeetingSetting>('/meetings/settings', setupForm);
      setSettings(saved);
      setShowSetup(false);
    } catch (err) {
      setSetupError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const created = await api.post<MeetingRecord>('/meetings', form);
      setShowForm(false);
      navigate(`/meeting-record/${created.meetingId}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(m: MeetingRecord) {
    if (!confirm(`ลบการประชุม "${m.topic}"? (รายการ project ในการประชุมจะถูกลบด้วย)`)) return;
    try {
      await api.del(`/meetings/${m.meetingId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div className="meeting">
      <div className="section-head">
        <h1 className="meeting__title">Meeting Record</h1>
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
          <button className="btn btn--sm" onClick={openSetup}>⚙ ตั้งค่า Default</button>
          <button className="btn btn--primary" onClick={openCreate}>+ สร้างการประชุม</button>
        </span>
      </div>
      <p className="muted meeting__hint">บันทึกการประชุม Update Project Status รายสัปดาห์</p>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>หัวข้อการประชุม</th>
              <th className="num">จำนวน Project</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="muted">ยังไม่มีการประชุม</td></tr>
            ) : (
              rows.map((m) => (
                <tr key={m.meetingId}>
                  <td className="nowrap">{m.meetingDate}</td>
                  <td>
                    <a style={{ cursor: 'pointer' }} onClick={() => navigate(`/meeting-record/${m.meetingId}`)}>
                      {m.topic}
                    </a>
                    {m.isClosed && <span className="badge badge--green" style={{ marginLeft: 'var(--space-2)' }}>ปิดแล้ว</span>}
                  </td>
                  <td className="num">{m.lineCount}</td>
                  <td className="num">
                    <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--sm" onClick={() => navigate(`/meeting-record/${m.meetingId}`)}>เปิด</button>
                      <button className="btn btn--sm btn--danger" onClick={() => remove(m)}>ลบ</button>
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title="สร้างการประชุม" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <MeetingHeaderFields form={form} setForm={setForm} resources={resources} />

            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {showSetup && (
        <Modal title="ตั้งค่า Default สำหรับการประชุมใหม่" onClose={() => setShowSetup(false)}>
          <form onSubmit={submitSetup}>
            <p className="muted" style={{ marginTop: 0 }}>ค่าที่ตั้งไว้จะถูกเติมให้อัตโนมัติเมื่อกด “สร้างการประชุม”</p>

            <label className="field-label">Agenda เริ่มต้น (บรรทัดละ 1 หัวข้อ)</label>
            <textarea className="input" rows={4} value={setupForm.defaultAgenda ?? ''}
              placeholder={'Update Project Status\nTeam Calendar\nOther\nSale'}
              onChange={(e) => setSetupForm({ ...setupForm, defaultAgenda: e.target.value === '' ? null : e.target.value })} />

            <label className="field-label">ผู้เข้าประชุมเริ่มต้น (บรรทัดละ 1 คน)</label>
            <textarea className="input" rows={4} value={setupForm.defaultAttendees ?? ''}
              placeholder={'นายคาวี สวัสดิ์รักษ์ (PM)\nนางสาวกนกพร พละแสน (SA)'}
              onChange={(e) => setSetupForm({ ...setupForm, defaultAttendees: e.target.value === '' ? null : e.target.value })} />

            <label className="field-label">Prepared by เริ่มต้น (เลือกจาก Resource)</label>
            <select className="input" value={setupForm.defaultPreparedBy ?? ''}
              onChange={(e) => setSetupForm({ ...setupForm, defaultPreparedBy: e.target.value === '' ? null : e.target.value })}>
              <option value="">— ไม่ระบุ —</option>
              {setupForm.defaultPreparedBy && !resources.some((r) => r.name === setupForm.defaultPreparedBy) && (
                <option value={setupForm.defaultPreparedBy}>{setupForm.defaultPreparedBy}</option>
              )}
              {resources.map((r) => (
                <option key={r.resourceId} value={r.name}>{r.name}{r.position ? ` (${r.position})` : ''}</option>
              ))}
            </select>

            {setupError && <p className="error-text">{setupError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowSetup(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
