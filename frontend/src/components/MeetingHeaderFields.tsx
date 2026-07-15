import type { MeetingRecordUpsert, Resource } from '../api/types';

// Renders a resource-name <select> (value = resource name) with a blank option.
function ResourceSelect({ value, onChange, resources }: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  resources: Resource[];
}) {
  // Keep a stale/custom value (e.g. a name no longer in the master) selectable.
  const known = resources.some((r) => r.name === value);
  return (
    <select className="input" value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      <option value="">— ไม่ระบุ —</option>
      {!known && value ? <option value={value}>{value}</option> : null}
      {resources.map((r) => (
        <option key={r.resourceId} value={r.name}>{r.name}{r.position ? ` (${r.position})` : ''}</option>
      ))}
    </select>
  );
}

// Shared meeting-header form fields (used by the create modal on the list page
// and the edit modal on the detail page). Wrap in a <form> and add actions around it.
export function MeetingHeaderFields({
  form,
  setForm,
  resources,
}: {
  form: MeetingRecordUpsert;
  setForm: (f: MeetingRecordUpsert) => void;
  resources: Resource[];
}) {
  return (
    <>
      <label className="field-label">วันที่ประชุม</label>
      <input className="input" type="date" value={form.meetingDate}
        onChange={(e) => setForm({ ...form, meetingDate: e.target.value })} required />

      <label className="field-label">หัวข้อการประชุม (Topic)</label>
      <input className="input" value={form.topic}
        placeholder="เช่น Weekly Meeting M01-Week 1 (MWS)"
        onChange={(e) => setForm({ ...form, topic: e.target.value })} required />

      <label className="field-label">Agenda (บรรทัดละ 1 หัวข้อ)</label>
      <textarea className="input" rows={3} value={form.agenda ?? ''}
        placeholder={'Update Project Status\nTeam Calendar\nOther\nSale'}
        onChange={(e) => setForm({ ...form, agenda: e.target.value === '' ? null : e.target.value })} />

      <label className="field-label">ผู้เข้าประชุม / Attendance (บรรทัดละ 1 คน เช่น "ชื่อ (PM)")</label>
      <textarea className="input" rows={3} value={form.attendees ?? ''}
        placeholder={'นายคาวี สวัสดิ์รักษ์ (PM)\nนางสาวกนกพร พละแสน (SA)'}
        onChange={(e) => setForm({ ...form, attendees: e.target.value === '' ? null : e.target.value })} />

      <label className="field-label">ผู้บันทึกการประชุม / Prepared by (เลือกจาก Resource)</label>
      <ResourceSelect value={form.preparedBy} resources={resources}
        onChange={(v) => setForm({ ...form, preparedBy: v })} />
      <p className="muted" style={{ marginTop: 'var(--space-1)' }}>
        ผู้รับรองการประชุมจะบันทึกเป็นชื่อผู้ที่กด “Close Meeting” โดยอัตโนมัติ
      </p>

      <label className="field-label">Next Meeting (วันที่)</label>
      <input className="input" type="date" value={form.nextMeetingDate ?? ''}
        onChange={(e) => setForm({ ...form, nextMeetingDate: e.target.value === '' ? null : e.target.value })} />

      <label className="field-label">Next Meeting Prepared by (เลือกจาก Resource)</label>
      <ResourceSelect value={form.nextMeetingPreparedBy} resources={resources}
        onChange={(v) => setForm({ ...form, nextMeetingPreparedBy: v })} />

      <label className="field-label">หมายเหตุ (ไม่บังคับ)</label>
      <input className="input" value={form.notes ?? ''}
        onChange={(e) => setForm({ ...form, notes: e.target.value === '' ? null : e.target.value })} />
    </>
  );
}
