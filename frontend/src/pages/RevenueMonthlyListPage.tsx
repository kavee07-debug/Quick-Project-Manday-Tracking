import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { RevenueMonth, RevenueMonthCreate } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { RefreshButton } from '../components/RefreshButton';
import './RevenueMonthlyPage.scss';

export const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const periodLabel = (year: number, month: number) => `${TH_MONTH[month - 1]} ${year} (${year}-${String(month).padStart(2, '0')})`;
export const money = (n?: number | null) =>
  n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function defaultForm(): RevenueMonthCreate {
  // Default to the month that just ended — that is the one being closed.
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { periodYear: d.getFullYear(), periodMonth: d.getMonth() + 1, note: null };
}

export default function RevenueMonthlyListPage() {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<RevenueMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RevenueMonthCreate>(defaultForm());
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<RevenueMonth[]>('/revenue-monthly'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(defaultForm());
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const created = await api.post<RevenueMonth>('/revenue-monthly', form);
      setShowForm(false);
      navigate(`/revenue-monthly/${created.revenueMonthId}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(m: RevenueMonth) {
    if (!confirm(`ลบงวด ${periodLabel(m.periodYear, m.periodMonth)}? (ข้อมูลที่ import ไว้จะถูกลบด้วย)`)) return;
    try {
      await api.del(`/revenue-monthly/${m.revenueMonthId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  const years: number[] = [];
  for (let y = new Date().getFullYear() + 1; y >= 2020; y--) years.push(y);

  return (
    <div className="rmon">
      <div className="section-head">
        <h1 className="rmon__title">Revenue Monthly</h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
          {isManager && <button className="btn btn--primary" onClick={openCreate}>+ สร้างงวด</button>}
        </div>
      </div>
      <p className="muted rmon__hint">
        รับรู้รายได้รายเดือนจากส่วนต่าง Progress — import รายงาน “Standard Progress vs Actual Progress Summary”
        2 ไฟล์ (สิ้นเดือนก่อน / สิ้นเดือนนี้) แล้วระบบคิดรายได้ = (%เดือนนี้ − %เดือนก่อน) × มูลค่าโครงการ
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>งวด</th>
              <th>ไฟล์เดือนก่อน</th>
              <th>ไฟล์เดือนนี้</th>
              <th className="num">จำนวน Job</th>
              <th className="num">รายได้ (Act.)</th>
              <th className="num">รายได้ (Std.)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="muted">กำลังโหลด…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="muted">ยังไม่มีงวด — กด “สร้างงวด” เพื่อเริ่ม</td></tr>
            ) : (
              rows.map((m) => (
                <tr key={m.revenueMonthId}>
                  <td className="nowrap">
                    {/* real <a href> so Ctrl/middle/right-click can open the period in a new tab */}
                    <Link to={`/revenue-monthly/${m.revenueMonthId}`}>{periodLabel(m.periodYear, m.periodMonth)}</Link>
                    {m.note && <div className="muted rmon__note">{m.note}</div>}
                  </td>
                  <td>{m.prevImportedAt
                    ? <span className="badge badge--green">{m.prevJobCount} job</span>
                    : <span className="muted">ยังไม่ import</span>}</td>
                  <td>{m.currImportedAt
                    ? <span className="badge badge--green">{m.currJobCount} job</span>
                    : <span className="muted">ยังไม่ import</span>}</td>
                  <td className="num">{m.jobCount}</td>
                  <td className="num">{money(m.totalAmountAct)}</td>
                  <td className="num">{money(m.totalAmountStd)}</td>
                  <td className="num">
                    <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--sm" onClick={() => navigate(`/revenue-monthly/${m.revenueMonthId}`)}>เปิด</button>
                      {isManager && <button className="btn btn--sm btn--danger" onClick={() => remove(m)}>ลบ</button>}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title="สร้างงวด Revenue Monthly" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">ปี</label>
            <select className="input" value={form.periodYear}
              onChange={(e) => setForm({ ...form, periodYear: Number(e.target.value) })}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            <label className="field-label">เดือน</label>
            <select className="input" value={form.periodMonth}
              onChange={(e) => setForm({ ...form, periodMonth: Number(e.target.value) })}>
              {TH_MONTH.map((label, i) => <option key={label} value={i + 1}>{label} ({i + 1})</option>)}
            </select>

            <label className="field-label">หมายเหตุ</label>
            <input className="input" value={form.note ?? ''} placeholder="ไม่บังคับ"
              onChange={(e) => setForm({ ...form, note: e.target.value === '' ? null : e.target.value })} />

            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">สร้าง</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
