import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ImportResult, RevenueMonthDetail, RevenueMonthLine } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { money, periodLabel } from './RevenueMonthlyListPage';
import { RefreshButton } from '../components/RefreshButton';
import './RevenueMonthlyPage.scss';

/** Which % column drives the revenue figure. */
type Basis = 'act' | 'std';
type Side = 'prev' | 'curr';
type SortKey = 'jobNo' | 'customer' | 'revenue' | 'prev' | 'curr' | 'delta' | 'amount';

const pct = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
// Timestamps are stored UTC; read back from SQL they arrive without a designator, so add one
// before parsing or the browser would read them as local time.
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleString('th-TH') : null;

/** Reads the basis-dependent numbers off a line so the table/KPIs stay basis-agnostic. */
function view(l: RevenueMonthLine, basis: Basis) {
  return basis === 'act'
    ? { prev: l.prevAct, curr: l.currAct, delta: l.deltaAct, amount: l.amountAct }
    : { prev: l.prevStd, curr: l.currStd, delta: l.deltaStd, amount: l.amountStd };
}

/** One upload slot for a snapshot side (previous / current month). */
function ImportSlot({ label, hint, fileName, importedAt, jobCount, reportInfo, canImport, busy, onPick }: {
  label: string;
  hint: string;
  fileName?: string | null;
  importedAt?: string | null;
  jobCount: number;
  reportInfo?: string | null;
  canImport: boolean;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`rmon__slot ${importedAt ? 'rmon__slot--done' : ''}`}>
      <div className="rmon__slot-head">
        <span className="rmon__slot-label">{label}</span>
        {importedAt
          ? <span className="badge badge--green">{jobCount} job</span>
          : <span className="badge badge--orange">ยังไม่ import</span>}
      </div>
      <div className="muted rmon__slot-hint">{hint}</div>
      {fileName && <div className="rmon__slot-file" title={fileName}>📄 {fileName}</div>}
      {importedAt && <div className="muted rmon__slot-meta">import เมื่อ {fmtDateTime(importedAt)}</div>}
      {reportInfo && <div className="muted rmon__slot-report" title={reportInfo}>{reportInfo}</div>}
      {canImport && (
        <>
          <input ref={inputRef} type="file" accept=".xlsx" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';       // allow re-selecting the same file
              if (f) onPick(f);
            }} />
          <button className="btn btn--sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'กำลัง import…' : importedAt ? 'import ใหม่ทับ' : 'เลือกไฟล์ .xlsx'}
          </button>
        </>
      )}
    </div>
  );
}

export default function RevenueMonthlyDetailPage() {
  const { id } = useParams();
  const { isManager } = useAuth();
  const [data, setData] = useState<RevenueMonthDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState<Basis>('act');
  const [search, setSearch] = useState('');
  const [onlyWithRevenue, setOnlyWithRevenue] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'amount', dir: 'desc' });
  const [busySide, setBusySide] = useState<Side | null>(null);
  const [result, setResult] = useState<{ side: Side; res: ImportResult } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<RevenueMonthDetail>(`/revenue-monthly/${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function importSide(side: Side, file: File) {
    setBusySide(side);
    setResult(null);
    setError(null);
    try {
      const res = await api.upload<ImportResult>(`/revenue-monthly/${id}/import/${side}`, file);
      setResult({ side, res });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import ไม่สำเร็จ');
    } finally {
      setBusySide(null);
    }
  }

  const lines = useMemo(() => data?.lines ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = lines;
    if (q) out = out.filter((l) =>
      l.jobNo.toLowerCase().includes(q) ||
      (l.jobName ?? '').toLowerCase().includes(q) ||
      (l.customer ?? '').toLowerCase().includes(q));
    if (onlyWithRevenue) out = out.filter((l) => view(l, basis).amount !== 0);
    return out;
  }, [lines, search, onlyWithRevenue, basis]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = view(a, basis), vb = view(b, basis);
      switch (sort.key) {
        case 'jobNo': return a.jobNo.localeCompare(b.jobNo) * dir;
        case 'customer': return (a.customer ?? '').localeCompare(b.customer ?? '') * dir;
        case 'revenue': return ((a.revenue ?? 0) - (b.revenue ?? 0)) * dir;
        case 'prev': return (va.prev - vb.prev) * dir;
        case 'curr': return (va.curr - vb.curr) * dir;
        case 'delta': return (va.delta - vb.delta) * dir;
        default: return (va.amount - vb.amount) * dir;
      }
    });
  }, [filtered, sort, basis]);

  const kpi = useMemo(() => {
    let total = 0, earning = 0, fresh = 0, backwards = 0;
    for (const l of filtered) {
      const v = view(l, basis);
      total += v.amount;
      if (v.amount > 0) earning++;
      if (l.status === 'New') fresh++;
      if (v.delta < 0) backwards++;
    }
    return { total, earning, fresh, backwards };
  }, [filtered, basis]);

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'jobNo' || key === 'customer' ? 'asc' : 'desc' }));
  }
  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  async function doExport() {
    if (!data) return;
    const { periodYear, periodMonth } = data.month;
    try {
      await api.download(`/revenue-monthly/${id}/export`,
        `revenue-monthly-${periodYear}-${String(periodMonth).padStart(2, '0')}.xlsx`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export ไม่สำเร็จ');
    }
  }

  if (loading && !data) return <p className="muted">กำลังโหลด…</p>;
  if (!data) return <p className="error-text">{error ?? 'ไม่พบงวดที่ระบุ'}</p>;

  const m = data.month;
  const prevMonth = m.periodMonth === 1
    ? { y: m.periodYear - 1, mo: 12 }
    : { y: m.periodYear, mo: m.periodMonth - 1 };

  return (
    <div className="rmon">
      <div className="section-head">
        <h1 className="rmon__title">
          <Link className="rmon__back" to="/revenue-monthly">← Revenue Monthly</Link>
          <span> / งวด {periodLabel(m.periodYear, m.periodMonth)}</span>
        </h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
          <button className="btn btn--sm" onClick={doExport}>⬇ Export .xlsx</button>
        </div>
      </div>
      {m.note && <p className="muted rmon__hint">{m.note}</p>}

      {error && <p className="error-text">{error}</p>}

      <div className="rmon__slots">
        <ImportSlot
          label="1) ข้อมูล ณ สิ้นเดือนก่อน"
          hint={`Standard Progress vs Actual Progress Summary ณ สิ้นเดือน ${prevMonth.mo}/${prevMonth.y}`}
          fileName={m.prevFileName} importedAt={m.prevImportedAt} jobCount={m.prevJobCount}
          reportInfo={m.prevReportInfo} canImport={isManager} busy={busySide === 'prev'}
          onPick={(f) => importSide('prev', f)} />
        <ImportSlot
          label="2) ข้อมูล ณ สิ้นเดือนนี้"
          hint={`Standard Progress vs Actual Progress Summary ณ สิ้นเดือน ${m.periodMonth}/${m.periodYear}`}
          fileName={m.currFileName} importedAt={m.currImportedAt} jobCount={m.currJobCount}
          reportInfo={m.currReportInfo} canImport={isManager} busy={busySide === 'curr'}
          onPick={(f) => importSide('curr', f)} />
      </div>

      {result && (
        <div className="rmon__result">
          <span className="badge badge--actual">
            {result.side === 'prev' ? 'เดือนก่อน' : 'เดือนนี้'}: อ่านได้ {result.res.created} job
          </span>
          {result.res.skipped > 0 && <span className="badge badge--adjust">ยุบแถวซ้ำ {result.res.skipped}</span>}
          {result.res.errors.length > 0 && (
            <ul className="rmon__warnings muted">
              {result.res.errors.map((msg, i) => <li key={i}>{msg}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="rmon__filterbar">
        <span className="rmon__filterbar-label">คิดรายได้จาก:</span>
        <button type="button" className={`status-chip badge--blue ${basis === 'act' ? 'is-active' : ''}`}
          aria-pressed={basis === 'act'} onClick={() => setBasis('act')}>
          % Progress by Act. Time sheet
        </button>
        <button type="button" className={`status-chip badge--orange ${basis === 'std' ? 'is-active' : ''}`}
          aria-pressed={basis === 'std'} onClick={() => setBasis('std')}>
          % Progress by Std.
        </button>
        <span className="rmon__filterbar-sep" />
        <input className="input rmon__search" type="search" placeholder="ค้นหา Job / ชื่องาน / ลูกค้า…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="rmon__check">
          <input type="checkbox" checked={onlyWithRevenue} onChange={(e) => setOnlyWithRevenue(e.target.checked)} />
          เฉพาะที่มีรายได้
        </label>
      </div>

      <div className="kpi-grid rmon__kpi">
        <div className="statcard statcard--teal">
          <div className="statcard__label">รายได้เดือนนี้ ({basis === 'act' ? 'Act.' : 'Std.'})</div>
          <div className="statcard__value">{money(kpi.total)}</div>
        </div>
        <div className="statcard statcard--green">
          <div className="statcard__label">Job ที่มีรายได้</div>
          <div className="statcard__value">{kpi.earning}</div>
        </div>
        <div className="statcard statcard--blue">
          <div className="statcard__label">Job ใหม่เดือนนี้</div>
          <div className="statcard__value">{kpi.fresh}</div>
        </div>
        <div className={`statcard ${kpi.backwards > 0 ? 'statcard--red' : 'statcard--navy'}`}>
          <div className="statcard__label">Job ที่ % ถอยหลัง</div>
          <div className="statcard__value">{kpi.backwards}</div>
        </div>
      </div>

      <div className="card">
        <table className="table rmon__table">
          <thead>
            <tr>
              <th className="rmon__sortable" onClick={() => toggleSort('jobNo')}>Job No.{sortArrow('jobNo')}</th>
              <th>ชื่องาน</th>
              <th className="rmon__sortable" onClick={() => toggleSort('customer')}>Customer{sortArrow('customer')}</th>
              <th className="num rmon__sortable" onClick={() => toggleSort('revenue')}>มูลค่าโครงการ{sortArrow('revenue')}</th>
              <th className="num rmon__sortable" onClick={() => toggleSort('prev')}>% เดือนก่อน{sortArrow('prev')}</th>
              <th className="num rmon__sortable" onClick={() => toggleSort('curr')}>% เดือนนี้{sortArrow('curr')}</th>
              <th className="num rmon__sortable" onClick={() => toggleSort('delta')}>Δ%{sortArrow('delta')}</th>
              <th className="num rmon__sortable" onClick={() => toggleSort('amount')}>รายได้เดือนนี้{sortArrow('amount')}</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={9} className="muted">
                {lines.length === 0 ? 'ยังไม่มีข้อมูล — import ไฟล์ทั้ง 2 ฝั่งก่อน' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
              </td></tr>
            ) : (
              sorted.map((l) => {
                const v = view(l, basis);
                return (
                  <tr key={l.jobNo}>
                    <td className="nowrap">{l.jobNo}</td>
                    <td>{l.jobName}</td>
                    <td>{l.customer}</td>
                    <td className="num">
                      {money(l.revenue)}
                      {l.revenueChanged && (
                        <span className="badge badge--orange rmon__tag"
                          title={`มูลค่าเปลี่ยนจาก ${money(l.prevRevenue)} เป็น ${money(l.revenue)} — ใช้ค่าเดือนปัจจุบัน`}>
                          เปลี่ยน
                        </span>
                      )}
                    </td>
                    <td className="num">{pct(v.prev)}</td>
                    <td className="num">{pct(v.curr)}</td>
                    <td className={`num ${v.delta < 0 ? 'over-budget' : ''}`}>
                      {v.delta > 0 ? '+' : ''}{pct(v.delta)}
                    </td>
                    <td className={`num rmon__amount ${v.amount < 0 ? 'over-budget' : ''}`}>{money(v.amount)}</td>
                    <td className="nowrap">
                      {l.status === 'New' && <span className="badge badge--blue">ใหม่</span>}
                      {l.status === 'Gone' && <span className="badge badge--red">ไม่มีเดือนนี้</span>}
                      {l.mergedRowCount > 1 && (
                        <span className="badge badge--adjust rmon__tag" title={`ยุบจาก ${l.mergedRowCount} แถวในไฟล์`}>
                          ⚠️ {l.mergedRowCount} แถว
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7} className="num rmon__totallabel">รวม {sorted.length} job</td>
                <td className={`num rmon__amount ${kpi.total < 0 ? 'over-budget' : ''}`}>{money(kpi.total)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
