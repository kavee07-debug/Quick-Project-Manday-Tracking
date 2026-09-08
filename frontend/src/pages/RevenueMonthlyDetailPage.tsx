import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type {
  ImportResult, RevenueMonthDetail, RevenueMonthEstimate, RevenueMonthLine, RevenueMonthManualUpsert,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { money, periodLabel, RevenueStatusBadge } from './RevenueMonthlyListPage';
import { Modal } from '../components/Modal';
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
  const [estimate, setEstimate] = useState<RevenueMonthEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [editingJob, setEditingJob] = useState<string | null>(null);   // job whose % is being typed
  const [editValue, setEditValue] = useState('');
  const [savingJob, setSavingJob] = useState<string | null>(null);
  // "+ เพิ่มบรรทัด": null = closed, 0 = adding, >0 = editing that manual line
  const [manualForm, setManualForm] = useState<RevenueMonthManualUpsert | null>(null);
  const [manualId, setManualId] = useState<number | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetValue, setTargetValue] = useState('');

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

  // Until this month's snapshot is imported every imported row reads as 0% now, which would show a
  // large negative "revenue". The hand-keyed lines are the only ones that mean anything yet, so show
  // just those — adding a line before any import is a normal way to start a period.
  const lines = useMemo(() => {
    const all = data?.lines ?? [];
    return data?.month.currImportedAt ? all : all.filter((l) => l.isManual);
  }, [data]);

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
    let total = 0, earning = 0, fresh = 0, backwards = 0, backlog = 0;
    for (const l of filtered) {
      const v = view(l, basis);
      total += v.amount;
      if (v.amount > 0) earning++;
      if (l.status === 'New') fresh++;
      if (v.delta < 0) backwards++;
      // Backlog = the part of each project's value not recognised yet at this month's %.
      backlog += Math.max(0, 100 - v.curr) / 100 * (l.revenue ?? 0);
    }
    return { total, earning, fresh, backwards, backlog };
  }, [filtered, basis]);

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'jobNo' || key === 'customer' ? 'asc' : 'desc' }));
  }
  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  /** Confirm closes the month (read-only); Reopen puts it back to "Est Revenue". */
  async function setConfirmed(confirm: boolean) {
    if (confirm && !window.confirm('Confirm Revenue งวดนี้? หลังจากนี้จะแก้ไข/import/ลบไม่ได้จนกว่าจะกด Reopen')) return;
    setError(null);
    try {
      setData(await api.post<RevenueMonthDetail>(`/revenue-monthly/${id}/${confirm ? 'confirm' : 'reopen'}`, {}));
      setEditingJob(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  }

  /** Writes (or with value = null clears) the hand-corrected % for one job on the active basis. */
  async function saveOverride(jobNo: string, value: number | null) {
    setSavingJob(jobNo);
    setError(null);
    try {
      setData(await api.put<RevenueMonthDetail>(`/revenue-monthly/${id}/override`, { jobNo, basis, value }));
      setEditingJob(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกการแก้ไขไม่สำเร็จ');
    } finally {
      setSavingJob(null);
    }
  }

  function commitEdit(jobNo: string, currentValue: number) {
    const raw = editValue.trim();
    const num = Number(raw);
    if (raw === '' || Number.isNaN(num) || num < 0 || num > 100) { setEditingJob(null); return; }
    if (num === currentValue) { setEditingJob(null); return; }   // nothing actually changed
    saveOverride(jobNo, num);
  }

  const emptyManual = (): RevenueMonthManualUpsert => ({
    jobNo: '', jobName: null, customer: null,
    revenue: null, prevProgress: null, currProgress: null, amount: null, note: null,
  });

  function openManualAdd() {
    setManualId(null);
    setManualForm(emptyManual());
    setManualError(null);
  }

  function openManualEdit(l: RevenueMonthLine) {
    setManualId(l.manualLineId ?? null);
    setManualForm({
      jobNo: l.jobNo, jobName: l.jobName ?? null, customer: l.customer ?? null,
      revenue: l.revenue ?? null, prevProgress: l.prevAct, currProgress: l.currAct,
      // Only a line whose amount was typed in has no project value to derive it from.
      amount: l.revenue == null ? l.amountAct : null,
      note: l.note ?? null,
    });
    setManualError(null);
  }

  async function submitManual(e: FormEvent) {
    e.preventDefault();
    if (!manualForm) return;
    setManualError(null);
    try {
      const path = manualId
        ? `/revenue-monthly/${id}/manual-lines/${manualId}`
        : `/revenue-monthly/${id}/manual-lines`;
      const saved = manualId
        ? await api.put<RevenueMonthDetail>(path, manualForm)
        : await api.post<RevenueMonthDetail>(path, manualForm);
      setData(saved);
      setManualForm(null);
    } catch (err) {
      setManualError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function removeManual(l: RevenueMonthLine) {
    if (!l.manualLineId) return;
    if (!confirm(`ลบบรรทัดที่เพิ่มเอง "${l.jobNo}" ?`)) return;
    setError(null);
    try {
      await api.del(`/revenue-monthly/${id}/manual-lines/${l.manualLineId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  async function saveTarget() {
    const raw = targetValue.trim();
    const amount = raw === '' ? null : Number(raw);
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) { setEditingTarget(false); return; }
    setError(null);
    try {
      setData(await api.put<RevenueMonthDetail>(`/revenue-monthly/${id}/target`, { amount }));
      setEditingTarget(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึก Target ไม่สำเร็จ');
    }
  }

  async function loadEstimate() {
    setEstimating(true);
    setError(null);
    try {
      setEstimate(await api.get<RevenueMonthEstimate>(`/revenue-monthly/${id}/estimate`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'คำนวณยอดประมาณการไม่สำเร็จ');
    } finally {
      setEstimating(false);
    }
  }

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
          <span className="rmon__statustag"><RevenueStatusBadge confirmed={m.isConfirmed} /></span>
        </h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
          <button className="btn btn--sm" onClick={doExport}>⬇ Export .xlsx</button>
          {isManager && !m.isConfirmed && (
            <button className="btn btn--sm" onClick={openManualAdd}
              title="เพิ่มบรรทัดเอง — ไว้คีย์ Est. รายได้ที่ยังไม่มีในรายงาน">
              ＋ เพิ่มบรรทัด
            </button>
          )}
          {isManager && (m.isConfirmed
            ? <button className="btn btn--sm btn--navy" onClick={() => setConfirmed(false)}>Reopen</button>
            : <button className="btn btn--sm btn--primary" onClick={() => setConfirmed(true)}>✓ Confirm Revenue</button>)}
        </div>
      </div>
      {m.note && <p className="muted rmon__hint">{m.note}</p>}
      {m.isConfirmed && (
        <p className="muted rmon__hint">
          🔒 งวดนี้ Confirm Revenue แล้ว{m.confirmedBy ? ` โดย ${m.confirmedBy}` : ''}
          {m.confirmedAt ? ` เมื่อ ${fmtDateTime(m.confirmedAt)}` : ''} — ตัวเลขถือเป็นค่าสุดท้าย แก้ไข/import/ลบไม่ได้
          จนกว่าจะกด Reopen
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="rmon__slots">
        <ImportSlot
          label="1) ข้อมูล ณ สิ้นเดือนก่อน"
          hint={`Standard Progress vs Actual Progress Summary ณ สิ้นเดือน ${prevMonth.mo}/${prevMonth.y}`}
          fileName={m.prevFileName} importedAt={m.prevImportedAt} jobCount={m.prevJobCount}
          reportInfo={m.prevReportInfo} canImport={isManager && !m.isConfirmed} busy={busySide === 'prev'}
          onPick={(f) => importSide('prev', f)} />
        <ImportSlot
          label="2) ข้อมูล ณ สิ้นเดือนนี้"
          hint={`Standard Progress vs Actual Progress Summary ณ สิ้นเดือน ${m.periodMonth}/${m.periodYear}`}
          fileName={m.currFileName} importedAt={m.currImportedAt} jobCount={m.currJobCount}
          reportInfo={m.currReportInfo} canImport={isManager && !m.isConfirmed} busy={busySide === 'curr'}
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

      {/* Until this month's snapshot is in, the only thing we can offer is a forecast from the months already closed. */}
      {!m.currImportedAt && (
        <div className="rmon__forecast card">
          <div className="rmon__forecast-head">
            <span className="rmon__forecast-title">📈 ยอดประมาณการเดือนนี้</span>
            <button className="btn btn--sm" onClick={loadEstimate} disabled={estimating}>
              {estimating ? 'กำลังคำนวณ…' : estimate ? 'คำนวณใหม่' : 'ดูยอดประมาณการ'}
            </button>
          </div>
          <p className="muted rmon__forecast-hint">
            ยังไม่ได้ import ข้อมูล ณ สิ้นเดือนนี้ — กดเพื่อประมาณการจากงวดที่ปิดแล้วย้อนหลังไม่เกิน 12 เดือน
            (เฉลี่ยถ่วงน้ำหนัก เดือนล่าสุดมีน้ำหนักมากที่สุด)
          </p>

          {estimate && (estimate.sources.length === 0 ? (
            <p className="muted">
              ยังไม่มีงวดก่อนหน้าที่ import ครบทั้ง 2 ฝั่ง — สร้างงวดของเดือนก่อนๆ แล้ว import ให้ครบก่อน
              ระบบถึงจะประมาณการได้
            </p>
          ) : (() => {
            const est = basis === 'act' ? estimate.estimateAct : estimate.estimateStd;
            const raw = basis === 'act' ? estimate.rawAct : estimate.rawStd;
            const capped = basis === 'act' ? estimate.cappedAct : estimate.cappedStd;
            const remaining = basis === 'act' ? estimate.remainingAct : estimate.remainingStd;
            return (
              <>
                <div className="rmon__forecast-value">
                  {money(est)} <span className="muted">บาท ({basis === 'act' ? 'Act.' : 'Std.'})</span>
                </div>
                {capped && (
                  <p className="muted">
                    ค่าเฉลี่ยถ่วงน้ำหนักได้ {money(raw)} แต่ถูกจำกัดไว้ที่ {money(remaining)} —
                    เท่ากับมูลค่าที่ยังรับรู้ไม่ครบของทุก Job ณ สิ้นเดือนก่อน
                  </p>
                )}
                {!capped && remaining != null && (
                  <p className="muted">มูลค่าที่ยังรับรู้ได้ทั้งหมด ณ สิ้นเดือนก่อน: {money(remaining)} บาท</p>
                )}
                <table className="table rmon__forecast-table">
                  <thead>
                    <tr><th>งวดที่ใช้คำนวณ</th><th className="num">รายได้จริง</th><th className="num">น้ำหนัก</th></tr>
                  </thead>
                  <tbody>
                    {estimate.sources.map((s) => (
                      <tr key={`${s.periodYear}-${s.periodMonth}`}>
                        <td className="nowrap">{periodLabel(s.periodYear, s.periodMonth)}</td>
                        <td className="num">{money(basis === 'act' ? s.amountAct : s.amountStd)}</td>
                        <td className="num">×{s.weight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          })())}
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

      {/* Imported rows are hidden until both sides are in (see the `lines` memo); say why, and keep
          showing whatever was keyed in by hand. */}
      {!m.currImportedAt && (
        <div className="card rmon__pending muted">
          ยังไม่ได้ import ข้อมูล ณ สิ้นเดือนนี้ — ตัวเลขด้านล่างนับเฉพาะ <b>บรรทัดที่เพิ่มเอง</b>
          {' '}ส่วนยอดจากรายงานจะคำนวณได้เมื่อ import ครบทั้ง 2 ฝั่ง
          {m.prevImportedAt && <> ระหว่างนี้ดู <b>ยอดประมาณการ</b> ด้านบนแทนได้</>}
        </div>
      )}

      <div className="kpi-grid rmon__kpi">
        <div className="statcard statcard--teal">
          <div className="statcard__label">
            รายได้เดือนนี้ ({basis === 'act' ? 'Act.' : 'Std.'}){!m.currImportedAt && ' · เฉพาะที่คีย์เอง'}
          </div>
          <div className="statcard__value">{money(kpi.total)}</div>
        </div>
        <div className="statcard statcard--navy">
          <div className="statcard__label">
            Target เดือนนี้
            {isManager && !m.isConfirmed && (
              <button type="button" className="rmon__iconbtn" title="ตั้ง Target ของงวดนี้"
                onClick={() => { setEditingTarget(true); setTargetValue(m.targetAmount == null ? '' : String(m.targetAmount)); }}>✏</button>
            )}
          </div>
          <div className="statcard__value">
            {editingTarget ? (
              <input className="input rmon__targetinput" type="number" step="0.01" min="0" autoFocus
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveTarget(); }
                  if (e.key === 'Escape') setEditingTarget(false);
                }}
                onBlur={saveTarget} placeholder="เว้นว่าง = ไม่ตั้ง" />
            ) : m.targetAmount == null ? <span className="muted">ยังไม่ตั้ง</span> : money(m.targetAmount)}
          </div>
        </div>
        <div className={`statcard ${m.targetAmount == null ? 'statcard--navy' : kpi.total - m.targetAmount >= 0 ? 'statcard--green' : 'statcard--red'}`}>
          <div className="statcard__label" title="รายได้เดือนนี้ − Target">Diff vs Target</div>
          <div className={`statcard__value${m.targetAmount == null ? ''
            : kpi.total - m.targetAmount > 0 ? ' under-budget'
            : kpi.total - m.targetAmount < 0 ? ' over-budget' : ''}`}>
            {m.targetAmount == null ? <span className="muted">—</span>
              : `${kpi.total - m.targetAmount > 0 ? '+' : ''}${money(kpi.total - m.targetAmount)}`}
          </div>
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
        <div className="statcard statcard--amber">
          <div className="statcard__label" title="Σ (100% − % เดือนนี้) × มูลค่าโครงการ">
            Backlog · รอรับรู้อีก
          </div>
          <div className="statcard__value">{money(kpi.backlog)}</div>
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
                {lines.length === 0
                  ? (m.currImportedAt ? 'ยังไม่มีข้อมูล — import ไฟล์ทั้ง 2 ฝั่งก่อน'
                    : 'ยังไม่มีข้อมูล — import ไฟล์ หรือกด “＋ เพิ่มบรรทัด” เพื่อคีย์เอง')
                  : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
              </td></tr>
            ) : (
              sorted.map((l) => {
                const v = view(l, basis);
                const edited = basis === 'act' ? l.editedAct : l.editedStd;
                const imported = basis === 'act' ? l.importedAct : l.importedStd;
                return (
                  <tr key={l.isManual ? `m${l.manualLineId}` : l.jobNo}
                    className={l.isManual ? 'rmon__row--manual' : edited ? 'rmon__row--edited' : ''}>
                    <td className="nowrap">
                      {l.isManual && <span className="rmon__manualicon" title="บรรทัดที่เพิ่มเอง">✚</span>}
                      {l.jobNo}
                    </td>
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
                    <td className="num rmon__currcell">
                      {editingJob === l.jobNo ? (
                        <input className="input rmon__editinput" type="number" step="0.01" min="0" max="100"
                          autoFocus value={editValue} disabled={savingJob === l.jobNo}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(l.jobNo, v.curr); }
                            if (e.key === 'Escape') setEditingJob(null);
                          }}
                          onBlur={() => commitEdit(l.jobNo, v.curr)} />
                      ) : (
                        <>
                          {pct(v.curr)}
                          {isManager && !m.isConfirmed && !l.isManual && (
                            <button type="button" className="rmon__iconbtn" title="แก้ไข % เดือนนี้"
                              onClick={() => { setEditingJob(l.jobNo); setEditValue(String(v.curr)); }}>✏</button>
                          )}
                          {edited && isManager && !m.isConfirmed && (
                            <button type="button" className="rmon__iconbtn" disabled={savingJob === l.jobNo}
                              title={`แก้จากค่าที่ import ${imported == null ? '(ไม่มีในไฟล์)' : pct(imported)}`
                                + (l.overrideBy ? ` โดย ${l.overrideBy}` : '') + ' — กดเพื่อคืนค่าเดิม'}
                              onClick={() => saveOverride(l.jobNo, null)}>↺</button>
                          )}
                        </>
                      )}
                    </td>
                    <td className={`num ${v.delta < 0 ? 'over-budget' : ''}`}>
                      {v.delta > 0 ? '+' : ''}{pct(v.delta)}
                    </td>
                    <td className={`num rmon__amount ${v.amount < 0 ? 'over-budget' : ''}`}>{money(v.amount)}</td>
                    <td className="nowrap">
                      {l.isManual && <span className="badge badge--purple">เพิ่มเอง</span>}
                      {l.isManual && isManager && !m.isConfirmed && (
                        <>
                          <button type="button" className="rmon__iconbtn" title="แก้ไขบรรทัดนี้"
                            onClick={() => openManualEdit(l)}>✏</button>
                          <button type="button" className="rmon__iconbtn" title="ลบบรรทัดนี้"
                            onClick={() => removeManual(l)}>🗑</button>
                        </>
                      )}
                      {l.note && <span className="muted rmon__tag" title={l.note}>{l.note}</span>}
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

      {manualForm && (
        <Modal title={manualId ? 'แก้ไขบรรทัดที่เพิ่มเอง' : 'เพิ่มบรรทัด (คีย์เอง)'} onClose={() => setManualForm(null)}>
          <form onSubmit={submitManual}>
            <p className="muted" style={{ marginTop: 0 }}>
              ใช้คีย์งานที่ยังไม่มีในรายงาน QERP · บรรทัดที่เพิ่มเอง <b>จะไม่หายเมื่อ import Excel ใหม่</b>
            </p>

            <label className="field-label">Job No *</label>
            <input className="input" required value={manualForm.jobNo}
              onChange={(e) => setManualForm({ ...manualForm, jobNo: e.target.value })} />

            <label className="field-label">ชื่องาน</label>
            <input className="input" value={manualForm.jobName ?? ''}
              onChange={(e) => setManualForm({ ...manualForm, jobName: e.target.value || null })} />

            <label className="field-label">Customer</label>
            <input className="input" value={manualForm.customer ?? ''}
              onChange={(e) => setManualForm({ ...manualForm, customer: e.target.value || null })} />

            <label className="field-label">มูลค่าโครงการ</label>
            <input className="input" type="number" step="0.01" min="0" value={manualForm.revenue ?? ''}
              onChange={(e) => setManualForm({ ...manualForm, revenue: e.target.value === '' ? null : Number(e.target.value) })} />

            <div className="rmon__formrow">
              <div>
                <label className="field-label">% เดือนก่อน</label>
                <input className="input" type="number" step="0.01" min="0" max="100" value={manualForm.prevProgress ?? ''}
                  onChange={(e) => setManualForm({ ...manualForm, prevProgress: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <div>
                <label className="field-label">% เดือนนี้</label>
                <input className="input" type="number" step="0.01" min="0" max="100" value={manualForm.currProgress ?? ''}
                  onChange={(e) => setManualForm({ ...manualForm, currProgress: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>

            <label className="field-label">รายได้เดือนนี้ (ถ้ากรอก จะใช้ค่านี้แทนการคิดจาก %)</label>
            <input className="input" type="number" step="0.01" value={manualForm.amount ?? ''}
              placeholder="เว้นว่าง = คิดจาก (% เดือนนี้ − % เดือนก่อน) × มูลค่าโครงการ"
              onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value === '' ? null : Number(e.target.value) })} />

            <label className="field-label">หมายเหตุ</label>
            <input className="input" value={manualForm.note ?? ''}
              onChange={(e) => setManualForm({ ...manualForm, note: e.target.value || null })} />

            {manualError && <p className="error-text">{manualError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setManualForm(null)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
