import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { BillingRate, BillingRateSaveResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { RefreshButton } from '../components/RefreshButton';
import { money } from './RevenueMonthlyListPage';
import './BillingPage.scss';

// Timestamps are stored UTC and come back without a designator — add one before parsing.
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleString('th-TH') : '';

/**
 * Billing Manday Rate — baht per manday, one rate per year. A billing line's Billing Manday is its
 * Line Amount ÷ the rate of its posting year (3 decimals). Changing a rate recalculates every line
 * of that year, and rescales the allocations of the year's locked lines so they still add up.
 */
export default function BillingRatesPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const [rates, setRates] = useState<BillingRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ year: string; rate: string; existing: BillingRate | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }   // the API refuses non-Admins anyway
    setLoading(true);
    try {
      setRates(await api.get<BillingRate[]>('/billing/rates'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    // Suggest the first year without a rate, starting from this year.
    const have = new Set(rates.map((r) => r.year));
    let y = new Date().getFullYear();
    while (have.has(y)) y++;
    setForm({ year: String(y), rate: '', existing: null });
    setFormError(null);
  }
  function openEdit(r: BillingRate) {
    setForm({ year: String(r.year), rate: String(r.rate), existing: r });
    setFormError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const year = Number(form.year);
    const rate = Number(form.rate.replace(/,/g, ''));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { setFormError('ปีไม่ถูกต้อง'); return; }
    if (!(rate > 0)) { setFormError('เรท Manday ต้องมากกว่า 0'); return; }
    if (!form.existing && rates.some((r) => r.year === year)) {
      setFormError(`ปี ${year} มีเรทอยู่แล้ว — กดแก้ไขที่แถวนั้นแทน`); return;
    }
    if (form.existing && form.existing.lockedLines > 0 && rate !== form.existing.rate
      && !window.confirm(`ปี ${year} มีรายการที่ Lock แล้ว ${form.existing.lockedLines} รายการ\n`
        + 'เมื่อเปลี่ยนเรท ระบบจะคำนวณ Billing Manday ใหม่ และปรับตัวเลข Allocate ของรายการที่ Lock '
        + 'ให้เท่ากับยอดใหม่โดยคงสัดส่วนของแต่ละคนไว้ — ดำเนินการต่อ?')) return;

    setBusy(true);
    setFormError(null);
    try {
      const res = await api.put<BillingRateSaveResult>(`/billing/rates/${year}`, { rate });
      setForm(null);
      setMessage(`บันทึกเรทปี ${year} = ${money(rate)} บาท/Manday แล้ว`
        + (res.rescaledLines > 0 ? ` · ปรับ Allocate ของรายการที่ Lock ให้ตรงยอดใหม่ ${res.rescaledLines} รายการ` : ''));
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: BillingRate) {
    if (!window.confirm(`ลบเรทปี ${r.year}? รายการของปีนี้จะคำนวณ Billing Manday ไม่ได้จนกว่าจะตั้งเรทใหม่`)) return;
    setError(null);
    setMessage(null);
    try {
      await api.del(`/billing/rates/${r.year}`);
      setMessage(`ลบเรทปี ${r.year} แล้ว`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  // Admin only (the menu hides it; this covers a typed URL).
  if (!isAdmin) {
    return (
      <div className="billing">
        <h1 className="billing__title">Billing Manday Rate</h1>
        <p className="error-text">หน้านี้สำหรับ Admin เท่านั้น — ดู Rate ของแต่ละปีได้ที่หัวคอลัมน์ในหน้า
          {' '}<Link to="/billing/kpi">Billing KPI Manday</Link></p>
      </div>
    );
  }

  return (
    <div className="billing">
      <div className="section-head">
        <h1 className="billing__title">Billing Manday Rate</h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
          <button className="btn btn--primary" onClick={openAdd}>+ เพิ่มเรท</button>
        </div>
      </div>
      <p className="muted billing__hint">
        เรท Manday (บาท/Manday) กำหนดต่อปี — ใช้คำนวณ <b>Billing Manday = Line Amount ÷ เรท</b> (ปัดทศนิยม 3 ตำแหน่ง)
        {' '}ตามปีของ Posting Date ในหน้า <Link to="/billing/allocate">Billing Manday Allocate</Link> ·
        {' '}เมื่อแก้ไขเรท ระบบจะคำนวณใหม่ทั้งปีอัตโนมัติ และปรับตัวเลข Allocate ของรายการที่ Lock แล้วให้ตรงยอดใหม่
      </p>

      {error && <p className="error-text">{error}</p>}
      {message && <p className="billing__ok">✓ {message}</p>}

      <div className="card billing__ratetable">
        <table className="table">
          <thead>
            <tr>
              <th>ปี</th>
              <th className="num">เรท (บาท / Manday)</th>
              <th className="num">จำนวนรายการในปี</th>
              <th className="num">Lock แล้ว</th>
              <th>แก้ไขล่าสุด</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="muted">กำลังโหลด…</td></tr>
            ) : rates.length === 0 ? (
              <tr><td colSpan={6} className="muted">ยังไม่มีเรท — กด “+ เพิ่มเรท”</td></tr>
            ) : rates.map((r) => (
              <tr key={r.year}>
                <td><b>{r.year}</b></td>
                <td className="num"><b>{money(r.rate)}</b></td>
                <td className="num">{r.lines.toLocaleString()}</td>
                <td className="num">{r.lockedLines > 0 ? `🔒 ${r.lockedLines.toLocaleString()}` : '—'}</td>
                <td className="muted">{r.updatedBy ?? ''} {fmtDateTime(r.updatedAt)}</td>
                <td className="num">
                  <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                    <button className="btn btn--sm" onClick={() => openEdit(r)}>แก้ไข</button>
                    <button className="btn btn--sm btn--danger" disabled={r.lockedLines > 0}
                      title={r.lockedLines > 0 ? 'มีรายการที่ Lock แล้ว — ลบไม่ได้ (แก้ไขเรทแทน)' : undefined}
                      onClick={() => remove(r)}>ลบ</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.existing ? `แก้ไขเรทปี ${form.existing.year}` : 'เพิ่มเรท Manday'} onClose={() => setForm(null)}>
          <form onSubmit={save}>
            <label className="field-label">ปี (ค.ศ.)</label>
            <input className="input" inputMode="numeric" value={form.year} disabled={!!form.existing}
              onChange={(e) => setForm({ ...form, year: e.target.value })} required />

            <label className="field-label">เรท (บาท / Manday)</label>
            <input className="input" inputMode="decimal" value={form.rate} autoFocus
              placeholder="เช่น 18000" onChange={(e) => setForm({ ...form, rate: e.target.value })} required />

            {form.existing && form.existing.lockedLines > 0 && (
              <p className="billing__warn" style={{ marginTop: 'var(--space-3)' }}>
                ปีนี้มีรายการที่ Lock แล้ว {form.existing.lockedLines} รายการ — เปลี่ยนเรทแล้วระบบจะปรับตัวเลข Allocate
                {' '}ของรายการเหล่านั้นให้ตรงกับ Billing Manday ใหม่โดยอัตโนมัติ (คงสัดส่วนของแต่ละคน)
              </p>
            )}
            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setForm(null)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
