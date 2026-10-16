import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { BillingKpi, BillingKpiRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PositionBadge } from '../components/PositionBadge';
import { RefreshButton } from '../components/RefreshButton';
import { money } from './RevenueMonthlyListPage';
import './BillingPage.scss';

const qty = (n?: number | null) =>
  n == null || n === 0 ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const round = (n: number) => Math.round(n * 10000) / 10000;
const sumYear = (rows: BillingKpiRow[], y: number) => round(rows.reduce((s, r) => s + (r.byYear[y] ?? 0), 0));

// Same order as the allocation matrix.
const GROUPS: { key: string; label: string }[] = [
  { key: 'SA', label: 'SA' }, { key: 'Dev', label: 'Dev' }, { key: 'PM', label: 'PM' }, { key: '', label: 'ไม่ระบุ Position' },
];

/**
 * Billing KPI Manday — manday allocated to each KPI resource, by posting year. Reads only confirmed,
 * live lines (see BillingController.Kpi). Rows are grouped SA → Dev → PM with a subtotal per group;
 * the footer carries the allocated total, the confirmed Billing Manday (Line Amount ÷ the year's
 * rate) and what is still unallocated.
 */
export default function BillingKpiPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');   // every role sees the KPI; only Admin gets the set-up links
  const [data, setData] = useState<BillingKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<BillingKpi>('/billing/kpi'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => data?.years ?? [], [data]);
  const groups = useMemo(() => {
    const rows = data?.rows ?? [];
    return GROUPS
      .map((g) => ({ ...g, rows: rows.filter((r) => (r.position ?? '') === g.key) }))
      .filter((g) => g.rows.length > 0);
  }, [data]);

  const allocatedTotal = round(years.reduce((s, y) => s + (data?.allocatedByYear[y] ?? 0), 0));
  // Manday allocated outside the resource master — already inside allocatedByYear.
  const otherTotal = round(years.reduce((s, y) => s + (data?.otherByYear[y] ?? 0), 0));
  const mandayTotal = round(years.reduce((s, y) => s + (data?.mandayByYear[y] ?? 0), 0));
  const amountTotal = years.reduce((s, y) => s + (data?.amountByYear[y] ?? 0), 0);
  const left = (y?: number) => y == null
    ? round(mandayTotal - allocatedTotal)
    : round((data?.mandayByYear[y] ?? 0) - (data?.allocatedByYear[y] ?? 0));
  const leftCls = (n: number) => (n === 0 ? 'under-budget' : 'over-budget');

  return (
    <div className="billing">
      <div className="section-head">
        <h1 className="billing__title">Billing KPI Manday</h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
        </div>
      </div>
      <p className="muted billing__hint">
        Manday จากการ Billing แยกตามปี (Posting Date) ของแต่ละ Resource ที่คิด KPI Billing —
        นับจากที่ Allocate ไว้ในหน้า <Link to="/billing/allocate">Billing Manday Allocate</Link>
        {' '}เฉพาะรายการที่ Confirm แล้ว · Rate ใต้ปีคือ Standard Rate (บาท / Manday) ที่ใช้คำนวณ Billing Manday
        {isAdmin && <> · กำหนดคนที่คิด KPI ได้ที่ <Link to="/resources">Master Resource</Link></>}
      </p>

      {error && <p className="error-text">{error}</p>}
      {data && data.missingRateYears.length > 0 && (
        <p className="billing__warn">
          ยังไม่ได้กำหนดเรท Manday ของปี <b>{data.missingRateYears.join(', ')}</b> — Billing Manday ของปีนี้จึงยังไม่ถูกนับ
          {isAdmin
            ? <> · ไปที่ <Link to="/billing/rates">Billing Manday Rate</Link> เพื่อกำหนดเรท</>
            : <> · แจ้ง Admin เพื่อกำหนดเรท</>}
        </p>
      )}

      {loading && !data ? (
        <p className="muted">กำลังโหลด…</p>
      ) : !data || data.rows.length === 0 ? (
        <div className="card billing__empty muted">
          ยังไม่มี Resource ที่คิด KPI Billing
          {isAdmin && <> — ไปที่ <Link to="/resources">Master Resource</Link> แล้วติ๊กช่อง <b>KPI Billing</b></>}
        </div>
      ) : years.length === 0 ? (
        <div className="card billing__empty muted">
          ยังไม่มีรายการที่ Confirm
          {isAdmin && <> — Confirm รายการที่หน้า <Link to="/billing/import">Billing Manday Import</Link>
            {' '}แล้ว Allocate ที่หน้า <Link to="/billing/allocate">Billing Manday Allocate</Link></>}
        </div>
      ) : (
        <>
          <div className="kpi-grid billing__kpi">
            <div className="statcard">
              <div className="statcard__label">Total Amount ที่ Confirm แล้ว (ทุกปี)</div>
              <div className="statcard__value">{money(amountTotal)}</div>
            </div>
            <div className="statcard statcard--blue">
              <div className="statcard__label">Manday ที่ Allocate แล้ว (ทุกปี)</div>
              <div className="statcard__value">{qty(allocatedTotal) === '—' ? '0' : qty(allocatedTotal)}</div>
            </div>
            <div className="statcard">
              <div className="statcard__label">Billing Manday ที่ Confirm แล้ว (ทุกปี)</div>
              <div className="statcard__value">{qty(mandayTotal) === '—' ? '0' : qty(mandayTotal)}</div>
            </div>
            <div className={`statcard ${left() === 0 ? 'statcard--green' : 'statcard--red'}`}>
              <div className="statcard__label">ยังไม่ Allocate</div>
              <div className={`statcard__value ${leftCls(left())}`}>{left().toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div className="card billing__kpitable">
            <table className="table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Position</th>
                  {years.map((y) => (
                    <th key={y} className="num">
                      {y}
                      <div className="billing__kpi-rate" title="Standard Rate (บาท / Manday) ของปีนี้">
                        {data.rateByYear[y] != null
                          ? `Rate ${data.rateByYear[y].toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                          : 'ยังไม่มี Rate'}
                      </div>
                    </th>
                  ))}
                  <th className="num billing__kpi-total">รวม</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key || 'none'}>
                    {g.rows.map((r) => (
                      <tr key={r.resourceId} className={r.isBillingKpi ? undefined : 'billing__kpi-off'}>
                        <td>
                          {r.name} <span className="muted">({r.code})</span>
                          {!r.isBillingKpi && (
                            <span className="badge badge--orange billing__kpi-flag"
                              title="ไม่ได้ติ๊ก KPI Billing แล้ว แต่ยังมี Manday ที่ Allocate ไว้">ไม่ได้คิด KPI</span>
                          )}
                        </td>
                        <td><PositionBadge position={r.position} /></td>
                        {years.map((y) => <td key={y} className="num">{qty(r.byYear[y])}</td>)}
                        <td className="num billing__kpi-total">{qty(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="billing__kpi-subtotal">
                      <td colSpan={2}>รวม {g.label}</td>
                      {years.map((y) => <td key={y} className="num">{qty(sumYear(g.rows, y))}</td>)}
                      <td className="num billing__kpi-total">
                        {qty(round(g.rows.reduce((s, r) => s + r.total, 0)))}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {/* Shown whenever any was allocated, so the people + Other add up to the grand total. */}
                {otherTotal !== 0 && (
                  <tr className="billing__kpi-subtotal">
                    <td colSpan={2}>Other <span className="muted">(นอกเหนือ Resource ในระบบ)</span></td>
                    {years.map((y) => <td key={y} className="num">{qty(data.otherByYear[y])}</td>)}
                    <td className="num billing__kpi-total">{qty(otherTotal)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="billing__kpi-grand">
                  <td colSpan={2}>รวม Allocate ทั้งหมด</td>
                  {years.map((y) => <td key={y} className="num">{qty(data.allocatedByYear[y])}</td>)}
                  <td className="num billing__kpi-total">{qty(allocatedTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="muted">Total Amount (Line Amount ที่ Confirm แล้ว)</td>
                  {years.map((y) => <td key={y} className="num muted">{money(data.amountByYear[y] ?? 0)}</td>)}
                  <td className="num muted billing__kpi-total">{money(amountTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="muted">Billing Manday ที่ Confirm แล้ว</td>
                  {years.map((y) => <td key={y} className="num muted">{qty(data.mandayByYear[y])}</td>)}
                  <td className="num muted billing__kpi-total">{qty(mandayTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="muted">ยังไม่ Allocate (Billing Manday − Allocate)</td>
                  {years.map((y) => (
                    <td key={y} className={`num ${leftCls(left(y))}`}>
                      {left(y).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  ))}
                  <td className={`num billing__kpi-total ${leftCls(left())}`}>
                    {left().toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
