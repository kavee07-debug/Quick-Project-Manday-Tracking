import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { MeetingLine, MeetingRecord } from '../api/types';
import './MeetingPrint.scss';

const NO_CUSTOMER = 'ไม่ระบุลูกค้า';

// Split a multiline textarea field into trimmed non-empty lines.
const lines = (s?: string | null) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

// Suggested download filename, e.g. "[Internal]-Weekly-Project-Status-20260715"
// (Chrome/Edge use document.title as the default "Save as PDF" filename).
function buildFileName(m: MeetingRecord) {
  const slug = m.topic.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-');
  const ymd = (m.meetingDate || '').replaceAll('-', '');
  return `[Internal]-${slug}-${ymd}`;
}

export default function MeetingPrintPage() {
  const { id } = useParams();
  const meetingId = Number(id);
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [rows, setRows] = useState<MeetingLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<MeetingRecord>(`/meetings/${meetingId}`),
      api.get<MeetingLine[]>(`/meetings/${meetingId}/lines`),
    ])
      .then(([m, ls]) => { setMeeting(m); setRows(ls); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'));
  }, [meetingId]);

  // Set the tab title = suggested filename so the print dialog defaults to it; restore on leave.
  useEffect(() => {
    if (!meeting) return;
    const prev = document.title;
    document.title = buildFileName(meeting);
    return () => { document.title = prev; };
  }, [meeting]);

  if (error) return <p className="error-text" style={{ padding: 24 }}>{error}</p>;
  if (!meeting) return <p className="muted" style={{ padding: 24 }}>กำลังโหลด…</p>;

  const fileName = buildFileName(meeting);
  async function copyFileName() {
    try {
      await navigator.clipboard.writeText(fileName);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('คัดลอกชื่อไฟล์:', fileName);
    }
  }

  // Group lines by customer, ordered by customer name then project code.
  const groups = new Map<string, MeetingLine[]>();
  for (const l of [...rows].sort((a, b) =>
    (a.customerName ?? NO_CUSTOMER).localeCompare(b.customerName ?? NO_CUSTOMER, undefined, { numeric: true })
    || a.projectCode.localeCompare(b.projectCode, undefined, { numeric: true }))) {
    const key = l.customerName ?? NO_CUSTOMER;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }

  const agenda = lines(meeting.agenda);
  const attendees = lines(meeting.attendees);

  return (
    <div className="mprint">
      <div className="mprint__toolbar no-print">
        <button className="btn btn--primary" onClick={() => window.print()}>🖨 พิมพ์ / Save as PDF</button>
        <button className="btn" onClick={() => navigate(`/meeting-record/${meetingId}`)}>← กลับ</button>
        <span className="mprint__toolbar-spacer" />
        <span className="muted">ชื่อไฟล์: <b>{fileName}</b></span>
        <button className="btn btn--sm" onClick={copyFileName}>{copied ? '✓ คัดลอกแล้ว' : '📋 คัดลอกชื่อไฟล์'}</button>
      </div>

      <div className="mprint__page">
        {/* A single table so <thead> (the header) auto-repeats on every printed page. */}
        <table className="mprint__doc">
          <thead>
            <tr><td>
              <div className="mprint__runhead">
                <img src="/logo.png" alt="Quick Transformation" className="mprint__logo" />
                <h1 className="mprint__title">Minute of Meeting</h1>
              </div>
            </td></tr>
          </thead>
          <tbody>
            <tr><td>
              {/* Page 1: meeting header info down to Next Meeting */}
              <table className="mprint__meta">
                <tbody>
                  <tr><th>Topic</th><td>{meeting.topic}</td></tr>
                  <tr><th>Date</th><td>{meeting.meetingDate}</td></tr>
                  {agenda.length > 0 && (
                    <tr><th>Agenda</th><td><ol className="mprint__ol">{agenda.map((a, i) => <li key={i}>{a}</li>)}</ol></td></tr>
                  )}
                  {attendees.length > 0 && (
                    <tr><th>Attendance</th><td><ul className="mprint__ul">{attendees.map((a, i) => <li key={i}>{a}</li>)}</ul></td></tr>
                  )}
                  {meeting.preparedBy && <tr><th>Prepared by</th><td>{meeting.preparedBy}</td></tr>}
                  {meeting.nextMeetingDate && <tr><th>Next Meeting</th><td>{meeting.nextMeetingDate}</td></tr>}
                  {meeting.nextMeetingPreparedBy && <tr><th>Next Meeting Prepared by</th><td>{meeting.nextMeetingPreparedBy}</td></tr>}
                </tbody>
              </table>

              {/* Project status starts on page 2 */}
              <div className="mprint__projwrap">
                <h2 className="mprint__h2">Update Project Status</h2>
                {rows.length === 0 ? (
                  <p className="muted">— ไม่มีรายการ project —</p>
                ) : (
                  [...groups.entries()].map(([customer, items]) => (
                    <section key={customer} className="mprint__group">
                      <h3 className="mprint__customer">{customer}</h3>
                      {items.map((l) => (
                        <div key={l.meetingLineId} className="mprint__proj">
                          <div className="mprint__projname"><b>{l.projectCode}</b> {l.projectName}</div>
                          <div className="mprint__field"><span className="mprint__label">สถานะโครงการ:</span> {l.statusSnapshot ?? '—'}
                            {l.progressSnapshot != null ? ` (${l.progressSnapshot}%)` : ''}</div>
                          <div className="mprint__field">
                            <span className="mprint__label">การดำเนินการ (Update Detail):</span>
                            <div className="mprint__text">{l.updateDetail || '—'}</div>
                          </div>
                          <div className="mprint__field">
                            <span className="mprint__label">Next Action:</span>
                            <div className="mprint__text">{l.nextAction || '—'}</div>
                          </div>
                        </div>
                      ))}
                    </section>
                  ))
                )}
              </div>

              {/* Last page: other topics + disclaimer + signatures */}
              <div className="mprint__footer">
                <h2 className="mprint__h2">สรุปการประชุมอื่นๆ (Internal)</h2>
                {meeting.otherTopics
                  ? <div className="mprint__text">{meeting.otherTopics}</div>
                  : <p className="muted">—</p>}

                <p className="mprint__note">
                  * โปรดตรวจสอบเนื้อหาในรายการการประชุม หากไม่มีการยืนยันหรือแจ้งแก้ไขภายใน 3 วัน
                  ขอถือว่ารายงานการประชุมนี้มีความสมบูรณ์
                </p>

                <div className="mprint__signs">
                  <div className="mprint__sign">
                    <div className="mprint__signrole">ผู้บันทึกการประชุม</div>
                    <div className="mprint__signline">(...................................)</div>
                    <div className="mprint__signname">{meeting.preparedBy ? `(${meeting.preparedBy})` : ''}</div>
                  </div>
                  <div className="mprint__sign">
                    <div className="mprint__signrole">ผู้รับรองการประชุม</div>
                    <div className="mprint__signline">(...................................)</div>
                    <div className="mprint__signname">{meeting.certifiedBy ? `(${meeting.certifiedBy})` : ''}</div>
                  </div>
                </div>
              </div>
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
