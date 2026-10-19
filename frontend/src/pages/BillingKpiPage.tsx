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
const signed = (n: number) =>
  `${n > 0 ? '+' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Allocate / Target / Diff over a set of rows for the given years. Diff only counts the person-years
 * that have a target — someone without one would otherwise pad the group's Diff with their whole
 * allocation. Target and Diff are null when no person-year has a target.
 */
function figures(rows: BillingKpiRow[], years: number[]) {
  let allocated = 0, target = 0, diff = 0, hasTarget = false;
  for (const r of rows) {
    for (const y of years) {
      const a = r.byYear[y] ?? 0;
      allocated += a;
      const t = r.targetByYear[y];
      if (t != null) { target += t; diff += a - t; hasTarget = true; }
    }
  }
  return { allocated: round(allocated), target: hasTarget ? round(target) : null, diff: hasTarget ? round(diff) : null };
}

// Same order as the allocation matrix.
const GROUPS: { key: string; label: string }[] = [
  { key: 'SA', label: 'SA' }, { key: 'Dev', label: 'Dev' }, { key: 'PM', label: 'PM' }, { key: '', label: 'ไม่ระบุ Position' },
];

/** The three cells of one year (or the total): Allocate | Target | Diff (Allocate − Target). */
function Triple({ f: { allocated, target, diff }, strong }: { f: ReturnType<typeof figures>; strong?: boolean }) {
  const cls = strong ? ' billing__kpi-total' : '';
  return (
    <>
      <td className={`num billing__kpi-ystart${cls}`}>{qty(allocated)}</td>
      <td className={`num muted${cls}`}>{target == null ? '—' : qty(target)}</td>
      <td className={`num${cls} ${diff == null ? 'muted' : diff >= 0 ? 'under-budget' : 'over-budget'}`}
        title={diff == null ? 'ยังไม่ได้กำหนด Target (Master Position Level)' : undefined}>
        {diff == null ? '—' : signed(diff)}
      </td>
    </>
  );
}

/**
 * Billing KPI Manday — manday allocated to each KPI resource, by posting year, against the manday
 * target of the resource's Position Level (Master Position Level). Reads only confirmed, live lines
 * (see BillingController.Kpi). Rows are grouped SA → Dev → PM with a subtotal per group; the footer
 * carries the allocated total, Total Amount, the confirmed Billing Manday (Line Amount ÷ the year's
 * rate) and what is still unallocated. The year chips narrow every figure; none picked = all years.
 */
export default function BillingKpiPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');   // every role sees the KPI; only Admin gets the set-up links
  const [data, setData] = useState<BillingKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());   // empty = every year

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

  const allYears = useMemo(() => data?.years ?? [], [data]);
  // A picked year that disappears on refresh simply stops counting.
  const years = useMemo(() => {
    const ys = allYears.filter((y) => picked.has(y));
    return ys.length > 0 ? ys : allYears;
  }, [allYears, picked]);
  function toggleYear(y: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  }

  const groups = useMemo(() => {
    const rows = data?.rows ?? [];
    return GROUPS
      .map((g) => ({ ...g, rows: rows.filter((r) => (r.position ?? '') === g.key) }))
      .filter((g) => g.rows.length > 0);
  }, [data]);

  const sumOf = (rec: Record<string, number> | undefined) => round(years.reduce((s, y) => s + (rec?.[y] ?? 0), 0));
  const allocatedTotal = sumOf(data?.allocatedByYear);
  // Manday allocated outside the resource master — already inside allocatedByYear.
  const otherTotal = sumOf(data?.otherByYear);
  const mandayTotal = sumOf(data?.mandayByYear);
  const amountTotal = years.reduce((s, y) => s + (data?.amountByYear[y] ?? 0), 0);
  const people = figures(data?.rows ?? [], years);
  const peopleDiff = people.diff;
  const left = (y?: number) => y == null
    ? round(mandayTotal - allocatedTotal)
    : round((data?.mandayByYear[y] ?? 0) - (data?.allocatedByYear[y] ?? 0));
  const leftCls = (n: number) => (n === 0 ? 'under-budget' : 'over-budget');
  const otherYears = years.some((y) => (data?.otherByYear[y] ?? 0) !== 0);

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
        {' '}เฉพาะรายการที่ Confirm แล้ว · Rate ใต้ปีคือ Standard Rate (บาท / Manday) ที่ใช้คำนวณ Billing Manday ·
        {' '}<b>Target</b> = Manday Target ต่อปีของ Position Level ของแต่ละคน, <b>Diff</b> = Allocate − Target
        {isAdmin && <> · กำหนดคนที่คิด KPI ได้ที่ <Link to="/resources">Master Resource</Link>,
          {' '}Level ที่ <Link to="/position-levels">Master Position Level</Link>,
          {' '}Target ที่ <Link to="/position-level-targets">Position Level Manday Target</Link></>}
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
      ) : allYears.length === 0 ? (
        <div className="card billing__empty muted">
          ยังไม่มีรายการที่ Confirm
          {isAdmin && <> — Confirm รายการที่หน้า <Link to="/billing/import">Billing Manday Import</Link>
            {' '}แล้ว Allocate ที่หน้า <Link to="/billing/allocate">Billing Manday Allocate</Link></>}
        </div>
      ) : (
        <>
          <div className="billing__filterbar">
            <span className="billing__label">ปี:</span>
            {allYears.map((y) => (
              <button key={y} type="button"
                className={`status-chip badge--blue ${picked.has(y) ? 'is-active' : ''}`}
                aria-pressed={picked.has(y)} onClick={() => toggleYear(y)}>
                {y}
              </button>
            ))}
            {picked.size > 0
              ? <button type="button" className="btn btn--sm" onClick={() => setPicked(new Set())}>ทุกปี</button>
              : <span className="muted">(ไม่เลือก = แสดงทุกปี)</span>}
          </div>

          <div className="kpi-grid billing__kpi">
            <div className="statcard">
              <div className="statcard__label">Total Amount ที่ Confirm แล้ว</div>
              <div className="statcard__value">{money(amountTotal)}</div>
            </div>
            <div className="statcard statcard--blue">
              <div className="statcard__label">Manday ที่ Allocate แล้ว</div>
              <div className="statcard__value">{qty(allocatedTotal) === '—' ? '0' : qty(allocatedTotal)}</div>
            </div>
            <div className="statcard">
              <div className="statcard__label">Manday Target (Resource)</div>
              <div className="statcard__value">{people.target == null ? '—' : qty(people.target) === '—' ? '0' : qty(people.target)}</div>
            </div>
            <div className={`statcard ${peopleDiff == null ? '' : peopleDiff >= 0 ? 'statcard--green' : 'statcard--red'}`}>
              <div className="statcard__label">Diff (Allocate − Target, คนที่มี Target)</div>
              <div className={`statcard__value ${peopleDiff == null ? '' : peopleDiff >= 0 ? 'under-budget' : 'over-budget'}`}>
                {peopleDiff == null ? '—' : signed(peopleDiff)}
              </div>
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
                  <th rowSpan={2}>Resource</th>
                  <th rowSpan={2}>Position</th>
                  <th rowSpan={2}>Level</th>
                  {years.map((y) => (
                    <th key={y} colSpan={3} className="center billing__kpi-ystart">
                      {y}
                      <div className="billing__kpi-rate" title="Standard Rate (บาท / Manday) ของปีนี้">
                        {data.rateByYear[y] != null
                          ? `Rate ${data.rateByYear[y].toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                          : 'ยังไม่มี Rate'}
                      </div>
                    </th>
                  ))}
                  <th colSpan={3} className="center billing__kpi-ystart billing__kpi-total">
                    รวม{years.length < allYears.length ? ` (${years.length} ปี)` : ''}
                  </th>
                </tr>
                <tr>
                  {[...years, 'total' as const].map((y) => (
                    <Fragment key={y}>
                      <th className="num billing__kpi-ystart billing__kpi-sub">Allocate</th>
                      <th className="num billing__kpi-sub">Target</th>
                      <th className="num billing__kpi-sub">Diff</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const sub = figures(g.rows, years);
                  return (
                    <Fragment key={g.key || 'none'}>
                      {g.rows.map((r) => {
                        const tot = figures([r], years);
                        return (
                          <tr key={r.resourceId} className={r.isBillingKpi ? undefined : 'billing__kpi-off'}>
                            <td>
                              {r.name} <span className="muted">({r.code})</span>
                              {!r.isBillingKpi && (
                                <span className="badge badge--orange billing__kpi-flag"
                                  title="ไม่ได้ติ๊ก KPI Billing แล้ว แต่ยังมี Manday ที่ Allocate ไว้">ไม่ได้คิด KPI</span>
                              )}
                            </td>
                            <td><PositionBadge position={r.position} /></td>
                            <td className="billing__kpi-level" title={r.levelName ?? undefined}>
                              {r.levelCode ?? <span className="muted">—</span>}
                            </td>
                            {years.map((y) => <Triple key={y} f={figures([r], [y])} />)}
                            <Triple f={tot} strong />
                          </tr>
                        );
                      })}
                      <tr className="billing__kpi-subtotal">
                        <td colSpan={3}>รวม {g.label}</td>
                        {years.map((y) => <Triple key={y} f={figures(g.rows, [y])} />)}
                        <Triple f={sub} strong />
                      </tr>
                    </Fragment>
                  );
                })}
                <tr className="billing__kpi-subtotal">
                  <td colSpan={3}>รวม Resource ทั้งหมด</td>
                  {years.map((y) => <Triple key={y} f={figures(data.rows, [y])} />)}
                  <Triple f={people} strong />
                </tr>
                {/* Shown whenever any was allocated, so the people + Other add up to the grand total. */}
                {otherYears && (
                  <tr className="billing__kpi-subtotal">
                    <td colSpan={3}>Other <span className="muted">(นอกเหนือ Resource ในระบบ)</span></td>
                    {years.map((y) => (
                      <td key={y} colSpan={3} className="num billing__kpi-ystart">{qty(data.otherByYear[y])}</td>
                    ))}
                    <td colSpan={3} className="num billing__kpi-ystart billing__kpi-total">{qty(otherTotal)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="billing__kpi-grand">
                  <td colSpan={3}>รวม Allocate ทั้งหมด</td>
                  {years.map((y) => (
                    <td key={y} colSpan={3} className="num billing__kpi-ystart">{qty(data.allocatedByYear[y])}</td>
                  ))}
                  <td colSpan={3} className="num billing__kpi-ystart billing__kpi-total">{qty(allocatedTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="muted">Total Amount (Line Amount ที่ Confirm แล้ว)</td>
                  {years.map((y) => (
                    <td key={y} colSpan={3} className="num muted billing__kpi-ystart">{money(data.amountByYear[y] ?? 0)}</td>
                  ))}
                  <td colSpan={3} className="num muted billing__kpi-ystart billing__kpi-total">{money(amountTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="muted">Billing Manday ที่ Confirm แล้ว</td>
                  {years.map((y) => (
                    <td key={y} colSpan={3} className="num muted billing__kpi-ystart">{qty(data.mandayByYear[y])}</td>
                  ))}
                  <td colSpan={3} className="num muted billing__kpi-ystart billing__kpi-total">{qty(mandayTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="muted">ยังไม่ Allocate (Billing Manday − Allocate)</td>
                  {years.map((y) => (
                    <td key={y} colSpan={3} className={`num billing__kpi-ystart ${leftCls(left(y))}`}>
                      {left(y).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  ))}
                  <td colSpan={3} className={`num billing__kpi-ystart billing__kpi-total ${leftCls(left())}`}>
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
