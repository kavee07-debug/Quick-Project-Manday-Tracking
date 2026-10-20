import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type {
  BillingAllocationResult, BillingConfirmResult, BillingDeleteResult, BillingImportResult, BillingJobCache,
  BillingJobSyncResult, BillingLine, BillingLockResult, BillingOtherResult, BillingResource, BillingYear,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PositionBadge } from '../components/PositionBadge';
import AutoAllocateModal from './AutoAllocateModal';
import { RefreshButton } from '../components/RefreshButton';
import { money, TH_MONTH } from './RevenueMonthlyListPage';
import './BillingPage.scss';

/**
 * import   — lines not confirmed yet: import the BC file, delete junk, confirm what goes on.
 * allocate — confirmed lines, ready to allocate; Unconfirm sends a line back to Import.
 * The same line is only ever on one of the two screens.
 */
export type BillingMode = 'import' | 'allocate';

// A year runs to thousands of lines; rendering them all at once froze the page for ~8 s per filter
// change. Draw a page at a time — filters, KPIs, select-all and the bulk actions cover every match.
const PAGE_SIZE = 200;

const qty = (n?: number | null) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
// Timestamps are stored UTC and come back without a designator — add one before parsing.
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).toLocaleString('th-TH') : '';
const fmtDate = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');

/** One table column: what it shows, and the value its filter box matches against. */
interface Column {
  key: string;
  label: ReactNode;
  filterLabel?: string;                 // plain-text name for the filter box (label may be markup)
  numeric?: boolean;
  sum?: boolean;                        // show a total in the footer (cross-check)
  value: (r: BillingLine) => string | number | null | undefined;
  render?: (r: BillingLine) => ReactNode;
  className?: string;
  headerClassName?: string;
}

/**
 * Column filter matching. Numeric columns take an optional comparison (">0", "<= 1.5", "=2",
 * "!=0"); a blank cell counts as 0 there, so "!=0" on คงเหลือ finds lines not fully allocated.
 * Anything else — and every text column — is a case-insensitive "contains".
 */
function matches(col: Column, r: BillingLine, raw: string): boolean {
  const term = raw.trim();
  if (!term) return true;
  const v = col.value(r);
  if (col.numeric) {
    const m = /^(>=|<=|!=|<>|>|<|=)\s*(-?[\d,]*\.?\d+)$/.exec(term);
    if (m) {
      const n = v == null || v === '' ? 0 : Number(v);
      const t = Number(m[2].replace(/,/g, ''));
      switch (m[1]) {
        case '>': return n > t;
        case '<': return n < t;
        case '>=': return n >= t;
        case '<=': return n <= t;
        case '!=': case '<>': return n !== t;
        default: return n === t;
      }
    }
  }
  return String(v ?? '').toLowerCase().includes(term.toLowerCase());
}

// Billing Manday (Line Amount ÷ the year's rate) is calculated to 3 decimals; allocation is
// compared at the same precision, so 0.1 + 0.2 reads as balanced.
const round3 = (n: number) => Math.round(n * 1000) / 1000;
// Every person's cell plus the "Other" share (outside the resource master).
const allocatedOf = (r: BillingLine) =>
  round3(Object.values(r.allocations ?? {}).reduce((s, q) => s + q, 0) + (r.otherQuantity ?? 0));
/** Billing Manday − allocated; null while the line's year has no manday rate. */
const remainingOf = (r: BillingLine) =>
  r.billingManday == null ? null : round3(r.billingManday - allocatedOf(r));
const yearOf = (r: BillingLine) => (r.postingDate ? Number(r.postingDate.slice(0, 4)) : null);

/**
 * The "Other (ระบุ)" note — who or which department an Other share is for. Plain text saved on
 * blur / Enter; read-only on a locked line.
 */
function OtherNoteCell({ value, locked, save }: {
  value: string | null | undefined;
  locked: boolean;
  save: (note: string | null) => Promise<void>;
}) {
  const shown = value ?? '';
  const [text, setText] = useState(shown);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState<string | undefined>();
  useEffect(() => { setText(shown); }, [shown]);

  async function commit() {
    const next = text.trim();
    if (next === shown) { setText(shown); return; }
    setState('saving');
    try {
      await save(next || null);
      setState('idle');
      setMessage(undefined);
    } catch (err) {
      setState('error');
      setMessage(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  if (locked) return <span className="muted">{shown}</span>;
  return (
    <input className={`input billing__other-note${state === 'error' ? ' is-error' : ''}${state === 'saving' ? ' is-saving' : ''}`}
      value={text} maxLength={200} placeholder="แผนก / ชื่อ…"
      title={message ?? 'ระบุว่า Other เป็นของใคร / แผนกไหน'}
      onChange={(e) => { setText(e.target.value); if (state === 'error') setState('idle'); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(shown); setState('idle'); }
      }} />
  );
}

/**
 * Evaluates a spreadsheet-style formula typed into a matrix cell — the text after a leading "=",
 * e.g. "2/2", "4.167*0.6", "(10+5)/3". Numbers (commas allowed), + − × ÷, unary minus and
 * brackets only; a tiny recursive-descent parser rather than eval(), so nothing but arithmetic
 * can ever run. Returns null for anything malformed or a division by zero.
 */
function evalFormula(src: string): number | null {
  const s = src.replace(/[\s,]/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/');
  let i = 0;
  const peek = () => s[i];

  function number(): number | null {
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    if (peek() === '-') { i++; const v = factor(); return v == null ? null : -v; }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (v == null || peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  }
  function term(): number | null {
    let v = factor();
    while (v != null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r == null || (op === '/' && r === 0)) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number | null {
    let v = term();
    while (v != null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = term();
      if (r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  if (!s) return null;
  const v = expr();
  return v != null && i === s.length && Number.isFinite(v) ? v : null;
}

/**
 * Where a line stands in allocation. "complete" = the cells add up to the Billing Manday and
 * something was allocated (a zero-manday line needs nothing, so it counts as complete) — the same
 * rule the API uses before it will lock a line. No rate for the year = never complete.
 */
type AllocStatus = 'none' | 'partial' | 'complete' | 'locked';
function allocStatusOf(r: BillingLine): AllocStatus {
  if (r.isAllocLocked) return 'locked';
  const allocated = allocatedOf(r);
  if (remainingOf(r) === 0 && (allocated !== 0 || r.billingManday === 0)) return 'complete';
  return allocated !== 0 ? 'partial' : 'none';
}
const ALLOC_STATUS: Record<AllocStatus, { label: string; badge: string }> = {
  none: { label: 'ยังไม่ Allocate', badge: 'billing__badge-none' },
  partial: { label: 'Allocate ไม่ครบ', badge: 'badge--orange' },
  complete: { label: 'Allocate ครบ', badge: 'badge--green' },
  locked: { label: '🔒 Locked', badge: 'billing__badge-locked' },
};
const ALLOC_FILTERS: { key: '' | AllocStatus; label: string }[] = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'none', label: ALLOC_STATUS.none.label },
  { key: 'partial', label: ALLOC_STATUS.partial.label },
  { key: 'complete', label: ALLOC_STATUS.complete.label },
  { key: 'locked', label: ALLOC_STATUS.locked.label },
];

/**
 * One cell of the allocation matrix (a person's share, or the "Other" share). Holds its own text
 * while typing and saves on blur / Enter, only when the value actually changed — `save` does the
 * request and patches the row. Escape puts the saved value back.
 */
function AllocCell({ value, locked, save }: {
  value: number | null | undefined;
  locked: boolean;
  save: (quantity: number | null) => Promise<void>;
}) {
  const shownValue = value == null ? '' : String(value);
  const [text, setText] = useState(shownValue);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState<string | undefined>();
  useEffect(() => { setText(shownValue); }, [shownValue]);

  async function commit() {
    const raw = text.trim();
    let next: number | null;
    if (raw === '') {
      next = null;
    } else if (raw.startsWith('=')) {
      // "=2/2" → 1, rounded to the 3 decimals Billing Manday uses.
      const v = evalFormula(raw.slice(1));
      if (v == null) { setState('error'); setMessage(`สูตรไม่ถูกต้อง: ${raw}`); return; }
      next = round3(v);
    } else {
      next = Number(raw.replace(/,/g, ''));
      if (Number.isNaN(next)) { setState('error'); setMessage('ตัวเลขไม่ถูกต้อง (หรือพิมพ์ = นำหน้าเพื่อใช้สูตร เช่น =2/2)'); return; }
    }
    if ((next ?? 0) === (value ?? 0)) { setText(shownValue); setState('idle'); return; }
    setState('saving');
    try {
      await save(next);
      setState('idle');
      setMessage(undefined);
    } catch (err) {
      setState('error');
      setMessage(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  // A locked line shows its figure as plain text — nothing to click into by accident.
  if (locked) return <span className="billing__alloc-locked">{shownValue ? qty(Number(shownValue)) : ''}</span>;

  return (
    <input className={`input billing__alloc-input${state === 'error' ? ' is-error' : ''}${state === 'saving' ? ' is-saving' : ''}`}
      // No inputMode="decimal": a numeric keypad has no "=", "/" or "*" for formulas.
      value={text} title={message ?? 'พิมพ์ตัวเลข หรือ = นำหน้าเพื่อคำนวณ เช่น =2/2, =4.167*0.6'}
      onChange={(e) => { setText(e.target.value); if (state === 'error') setState('idle'); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(shownValue); setState('idle'); }
      }} />
  );
}

/**
 * Moves `to` to the same relative position as `from`. Proportional rather than pixel-for-pixel:
 * the table also carries a vertical scrollbar, so the two scroll ranges differ by its width and a
 * straight copy would leave the ends out of step. Writes only on a real change (> 1px), so the
 * scroll event the write itself triggers finds them in step and stops — no ping-pong.
 */
function mirror(from: HTMLElement, to: HTMLElement) {
  const fromMax = from.scrollWidth - from.clientWidth;
  const toMax = to.scrollWidth - to.clientWidth;
  const next = fromMax > 0 ? (from.scrollLeft / fromMax) * toMax : 0;
  if (Math.abs(to.scrollLeft - next) > 1) to.scrollLeft = next;
}

/**
 * A horizontal scrollbar shown above a wide table, kept in step with the table's own one at the
 * bottom — so with a long list (and the matrix far to the right) you can slide left/right without
 * scrolling down first. Only appears when the table is actually wider than its box.
 */
function TopScrollbar({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({ content: 0, box: 0 });

  useEffect(() => {
    const box = target.current;
    if (!box) return;
    const measure = () => setWidth({ content: box.scrollWidth, box: box.clientWidth });
    measure();
    // The table widens/narrows as columns, filters and rows change — follow it.
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    if (box.firstElementChild) ro.observe(box.firstElementChild);

    const onTable = () => { if (barRef.current) mirror(box, barRef.current); };
    box.addEventListener('scroll', onTable, { passive: true });
    return () => { ro.disconnect(); box.removeEventListener('scroll', onTable); };
  }, [target]);

  if (width.content <= width.box + 1) return null;
  return (
    <div ref={barRef} className="billing__topscroll" aria-hidden="true"
      onScroll={(e) => { if (target.current) mirror(e.currentTarget, target.current); }}>
      <div style={{ width: width.content, height: 1 }} />
    </div>
  );
}

export default function BillingLinesPage({ mode }: { mode: BillingMode }) {
  const isImport = mode === 'import';
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  // Allocate is open to every role, but only Admin may change anything there; everyone else
  // gets a view-only screen (no selection, no actions, cells read-only). The API enforces it too.
  const readOnly = !isAdmin;
  const confirmedParam = isImport ? 'false' : 'true';

  const [years, setYears] = useState<BillingYear[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [rows, setRows] = useState<BillingLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState<BillingImportResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [jobCache, setJobCache] = useState<BillingJobCache | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [kpiResources, setKpiResources] = useState<BillingResource[]>([]);   // matrix columns (Allocate only)

  const [months, setMonths] = useState<Set<number>>(new Set());   // empty = every month
  const [search, setSearch] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [allocFilter, setAllocFilter] = useState<'' | AllocStatus>('');   // Allocate screen only
  const [autoOpen, setAutoOpen] = useState(false);                        // Auto Allocate dialog
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const fileRef = useRef<HTMLInputElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  // The year Refresh should reload — kept in a ref so `load` stays stable and runs once on mount.
  const yearRef = useRef<number | null>(null);

  const loadLines = useCallback(async (y: number) => {
    setRows(await api.get<BillingLine[]>(`/billing/lines?year=${y}&confirmed=${confirmedParam}`));
  }, [confirmedParam]);

  /** Reloads the year list and the current year's lines; filters are left as they are. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ys, cache, people] = await Promise.all([
        api.get<BillingYear[]>(`/billing/years?confirmed=${confirmedParam}`),
        api.get<BillingJobCache>('/billing/jobs/status'),
        confirmedParam === 'true' ? api.get<BillingResource[]>('/billing/resources') : Promise.resolve([]),
      ]);
      setYears(ys);
      setJobCache(cache);
      setKpiResources(people);
      // Keep the year on screen if it still has data, otherwise fall back to the newest.
      const keep = ys.some((x) => x.year === yearRef.current) ? yearRef.current : null;
      const y = keep ?? ys[0]?.year ?? null;
      yearRef.current = y;
      setYear(y);
      if (y != null) await loadLines(y); else setRows([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [confirmedParam, loadLines]);

  useEffect(() => { load(); }, [load]);

  async function changeYear(y: number) {
    yearRef.current = y;
    setYear(y);
    setSelected(new Set());
    setLoading(true);
    try { await loadLines(y); } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally { setLoading(false); }
  }

  async function importFile(file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    setImportResult(null);
    try {
      const res = await api.upload<BillingImportResult>('/billing/import', file);
      setImportResult(res);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /** Pulls every BC job's name and PM into the local cache, then relabels the lines on screen. */
  async function syncJobs() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<BillingJobSyncResult>('/billing/jobs/sync');
      setJobCache({ jobs: res.jobs, fetchedAt: res.fetchedAt });
      setMessage(`ดึงข้อมูล Job จาก BC แล้ว ${res.jobs.toLocaleString()} Job`
        + ` (มีชื่อ ${res.withName.toLocaleString()} · มี PM ${res.withPm.toLocaleString()})`);
      if (yearRef.current != null) await loadLines(yearRef.current);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดึงข้อมูล Job จาก BC ไม่สำเร็จ');
    } finally {
      setSyncing(false);
    }
  }

  /** A matrix cell was saved — patch that one line in place instead of reloading the year. */
  const onAllocSaved = useCallback((lineId: number, resourceId: number, quantity: number | null) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== lineId) return r;
      const cells = { ...(r.allocations ?? {}) };
      if (quantity == null) delete cells[resourceId]; else cells[resourceId] = quantity;
      return { ...r, allocations: cells };
    }));
  }, []);

  /** The Other share or its note was saved — patch that line in place. */
  const onOtherSaved = useCallback((lineId: number, res: BillingOtherResult) => {
    setRows((prev) => prev.map((r) => (r.id === lineId
      ? { ...r, otherQuantity: res.quantity ?? null, otherNote: res.note ?? null }
      : r)));
  }, []);

  // The allocation matrix, on the right of the line columns: the Billing Manday the line has to be
  // split into, one column per KPI resource (already ordered SA, Dev, PM by the API), then the
  // line's allocated total and what is left.
  const matrixColumns = useMemo<Column[]>(() => isImport ? [] : [
    {
      key: 'manday', label: 'Billing Manday', numeric: true, sum: true,
      headerClassName: 'billing__matrix-total', className: 'billing__matrix-total',
      value: (r) => r.billingManday,
      render: (r) => r.billingManday != null
        ? <span title={`${money(r.lineAmount)} ÷ เรท ${money(r.mandayRate)} (ปี ${yearOf(r)}) ปัดทศนิยม 3 ตำแหน่ง`}>
            {r.billingManday.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          </span>
        : <Link to="/billing/rates" className="billing__norate" title="ตั้งเรท Manday ของปีนี้ก่อน">
            ไม่มีเรทปี {yearOf(r)}
          </Link>,
    },
    ...kpiResources.map((p): Column => ({
      key: `res-${p.resourceId}`,
      label: <span className="billing__res-head">{p.name}<PositionBadge position={p.position} /></span>,
      filterLabel: p.name,
      numeric: true,
      sum: true,
      headerClassName: 'billing__matrix',
      className: 'billing__matrix',
      value: (r) => r.allocations?.[p.resourceId],
      render: (r) => (
        <AllocCell locked={readOnly || r.isAllocLocked} value={r.allocations?.[p.resourceId]}
          save={async (quantity) => {
            const res = await api.put<BillingAllocationResult>(
              `/billing/lines/${r.id}/allocations/${p.resourceId}`, { quantity });
            onAllocSaved(r.id, p.resourceId, res.quantity ?? null);
          }} />
      ),
    })),
    // "Other": manday that goes to someone outside the resource master (another department…),
    // plus a note saying who. Counts toward รวม Allocate like any person's cell.
    {
      key: 'other', label: 'Other', numeric: true, sum: true,
      headerClassName: 'billing__matrix billing__other-start', className: 'billing__matrix billing__other-start',
      value: (r) => r.otherQuantity,
      render: (r) => (
        <AllocCell locked={readOnly || r.isAllocLocked} value={r.otherQuantity}
          save={async (quantity) => {
            const res = await api.put<BillingOtherResult>(
              `/billing/lines/${r.id}/other`, { quantity, note: r.otherNote ?? null });
            onOtherSaved(r.id, res);
          }} />
      ),
    },
    {
      key: 'otherNote', label: 'Other (ระบุ)',
      headerClassName: 'billing__matrix', className: 'billing__matrix',
      value: (r) => r.otherNote,
      render: (r) => (
        <OtherNoteCell locked={readOnly || r.isAllocLocked} value={r.otherNote}
          save={async (note) => {
            const res = await api.put<BillingOtherResult>(
              `/billing/lines/${r.id}/other`, { quantity: r.otherQuantity ?? null, note });
            onOtherSaved(r.id, res);
          }} />
      ),
    },
    {
      key: 'allocated', label: 'รวม Allocate', numeric: true, sum: true,
      headerClassName: 'billing__matrix-total', className: 'billing__matrix-total',
      value: (r) => allocatedOf(r),
      render: (r) => qty(allocatedOf(r)),
    },
    {
      key: 'remaining', label: 'คงเหลือ', numeric: true, sum: true,
      headerClassName: 'billing__matrix-total', className: 'billing__matrix-total',
      value: (r) => remainingOf(r),
      render: (r) => {
        const left = remainingOf(r);
        if (left == null) return <span className="muted">—</span>;   // no rate → nothing to compare to
        // Balanced reads green; anything left over (or over-allocated) reads red once work has
        // started on the line; an untouched line stays plain.
        const cls = left === 0 ? 'under-budget' : allocatedOf(r) !== 0 ? 'over-budget' : 'muted';
        return <span className={cls}>{qty(left)}</span>;
      },
    },
  ], [isImport, kpiResources, onAllocSaved, onOtherSaved, readOnly]);

  const columns = useMemo<Column[]>(() => [
    { key: 'doc', label: 'Document No.', value: (r) => r.documentNo, className: 'nowrap' },
    { key: 'date', label: 'Posting Date', value: (r) => fmtDate(r.postingDate), className: 'nowrap' },
    { key: 'job', label: 'Job No.', value: (r) => r.projectNo, className: 'nowrap' },
    { key: 'task', label: 'Project Task', value: (r) => r.projectTaskNo, className: 'nowrap' },
    {
      key: 'jobName', label: 'ชื่อ Job', value: (r) => r.jobName, className: 'billing__wide',
      render: (r) => r.jobName ?? (r.projectNo ? <span className="muted">ไม่พบในระบบ</span> : '—'),
    },
    { key: 'pm', label: 'Project Manager', value: (r) => r.projectManager, className: 'nowrap' },
    {
      key: 'customer', label: 'ลูกค้า', value: (r) => r.customerSearchName ?? r.customerName, className: 'nowrap',
    },
    { key: 'type', label: 'Type', value: (r) => r.lineType },
    { key: 'no', label: 'No.', value: (r) => r.itemNo, className: 'nowrap' },
    { key: 'desc', label: 'รายการ', value: (r) => r.description, className: 'billing__wide' },
    {
      key: 'qty', label: 'Quantity', numeric: true, sum: true, value: (r) => r.quantity,
      render: (r) => qty(r.quantity),
    },
    { key: 'uom', label: 'UOM', value: (r) => r.unitOfMeasure },
    {
      key: 'amount', label: 'Line Amount', numeric: true, sum: true, value: (r) => r.lineAmount,
      render: (r) => money(r.lineAmount),
    },
    ...(isImport ? [] : [{
      key: 'confirmed', label: 'Confirm โดย', value: (r: BillingLine) =>
        `${r.confirmedBy ?? ''} ${fmtDateTime(r.confirmedAt)}`.trim(),
      className: 'nowrap',
    } satisfies Column, {
      key: 'allocStatus', label: 'สถานะ Allocate', className: 'nowrap',
      value: (r: BillingLine) => ALLOC_STATUS[allocStatusOf(r)].label,
      render: (r: BillingLine) => {
        const s = ALLOC_STATUS[allocStatusOf(r)];
        const tip = r.isAllocLocked ? `Lock โดย ${r.allocLockedBy ?? ''} ${fmtDateTime(r.allocLockedAt)}`.trim() : undefined;
        return <span className={`badge ${s.badge}`} title={tip}>{s.label}</span>;
      },
    } satisfies Column]),
    ...matrixColumns,
  ], [isImport, matrixColumns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = columns.filter((c) => (colFilters[c.key] ?? '').trim() !== '');
    return rows.filter((r) => {
      if (months.size > 0) {
        const m = r.postingDate ? Number(r.postingDate.slice(5, 7)) : 0;
        if (!months.has(m)) return false;
      }
      if (allocFilter && allocStatusOf(r) !== allocFilter) return false;
      for (const c of active) if (!matches(c, r, colFilters[c.key])) return false;
      if (q) {
        const hay = [r.documentNo, r.projectNo, r.projectTaskNo, r.jobName, r.projectManager, r.customerName,
          r.customerSearchName, r.itemNo, r.description].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, months, search, colFilters, columns, allocFilter]);

  // New filter results start again from the first page.
  useEffect(() => { setLimit(PAGE_SIZE); }, [rows, months, search, colFilters, allocFilter]);

  // Chip counts: how many of the year's lines (month filter applied) are in each allocation state.
  const allocCounts = useMemo(() => {
    const c: Record<'' | AllocStatus, number> = { '': 0, none: 0, partial: 0, complete: 0, locked: 0 };
    for (const r of rows) {
      if (months.size > 0 && !months.has(r.postingDate ? Number(r.postingDate.slice(5, 7)) : 0)) continue;
      c[''] += 1;
      c[allocStatusOf(r)] += 1;
    }
    return c;
  }, [rows, months]);
  const shown = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  // Only rows the filters still show count as selected, so an action never touches hidden rows.
  const visibleSelected = useMemo(() => filtered.filter((r) => selected.has(r.id)), [filtered, selected]);
  const allVisibleSelected = filtered.length > 0 && visibleSelected.length === filtered.length;
  const someVisibleSelected = visibleSelected.length > 0;
  const activeColFilters = Object.values(colFilters).filter((v) => v.trim() !== '').length;

  // Years on this screen whose lines can't be turned into Billing Manday — no rate set up yet.
  const missingRateYears = useMemo(() => [...new Set(
    rows.filter((r) => r.billingManday == null).map(yearOf).filter((y): y is number => y != null),
  )].sort(), [rows]);

  const kpi = useMemo(() => {
    let mdQty = 0, amount = 0;
    for (const r of filtered) {
      amount += r.lineAmount ?? 0;
      if ((r.unitOfMeasure ?? '').toUpperCase() === 'MD') mdQty += r.quantity ?? 0;
    }
    return { mdQty, amount };
  }, [filtered]);

  // Footer totals over every filtered line (not just the page drawn) — the cross-check row.
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of columns) {
      if (!c.sum) continue;
      let s = 0;
      for (const r of filtered) s += Number(c.value(r) ?? 0);
      out[c.key] = Math.round(s * 10000) / 10000;
    }
    return out;
  }, [columns, filtered]);

  const unlabelled = useMemo(
    () => rows.filter((r) => r.projectNo && (!r.jobName || !r.projectManager)).length, [rows]);
  const presentMonths = useMemo(
    () => new Set(rows.map((r) => (r.postingDate ? Number(r.postingDate.slice(5, 7)) : 0))), [rows]);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }
  function toggleMonth(m: number) {
    setMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  }
  const setColFilter = (key: string, value: string) => setColFilters((prev) => ({ ...prev, [key]: value }));

  /** Runs a bulk action on the selected rows, then reloads — moved/deleted rows drop off this screen. */
  // Which selected lines each Allocate-screen action can actually act on.
  const lockable = visibleSelected.filter((r) => allocStatusOf(r) === 'complete');
  const unlockable = visibleSelected.filter((r) => r.isAllocLocked);
  const unconfirmable = visibleSelected.filter((r) => !r.isAllocLocked);

  async function bulk(action: 'confirm' | 'unconfirm' | 'delete' | 'lock' | 'unlock') {
    // Send only the lines the action applies to; the API re-checks the same rules anyway.
    const pick = action === 'lock' ? lockable
      : action === 'unlock' ? unlockable
      : action === 'unconfirm' ? unconfirmable
      : visibleSelected;
    const ids = pick.map((r) => r.id);
    if (ids.length === 0) return;
    const n = ids.length.toLocaleString();
    const skippedLocked = action === 'unconfirm' ? visibleSelected.length - unconfirmable.length : 0;
    const prompts = {
      confirm: `Confirm ${n} รายการ? รายการจะย้ายไปหน้า Billing Manday Allocate`,
      unconfirm: `ยกเลิก Confirm ${n} รายการ? รายการจะย้ายกลับไปหน้า Billing Manday Import`
        + (skippedLocked > 0 ? `\n(ข้าม ${skippedLocked} รายการที่ Lock แล้ว — Unlock ก่อนถ้าต้องการ)` : ''),
      delete: `ลบ ${n} รายการ?\nรายการที่ลบจะไม่ถูก Import กลับมาอีก แม้ Import ไฟล์ที่มีเอกสารนี้ซ้ำ`,
      lock: `Lock ${n} รายการที่ Allocate ครบแล้ว?\nรายการที่ Lock จะแก้ตัวเลข Allocate และยกเลิก Confirm ไม่ได้จนกว่าจะ Unlock`,
      unlock: `Unlock ${n} รายการ? จะแก้ตัวเลข Allocate ได้อีกครั้ง`,
    };
    if (!window.confirm(prompts[action])) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (action === 'delete') {
        const res = await api.post<BillingDeleteResult>('/billing/lines/delete', { ids });
        setMessage(`ลบแล้ว ${res.deleted.toLocaleString()} รายการ`
          + (res.skippedConfirmed > 0 ? ` (ข้าม ${res.skippedConfirmed} รายการที่ Confirm แล้ว)` : ''));
      } else if (action === 'lock' || action === 'unlock') {
        const res = await api.post<BillingLockResult>(`/billing/lines/${action}`, { ids });
        setMessage(`${action === 'lock' ? 'Lock' : 'Unlock'} แล้ว ${res.updated.toLocaleString()} รายการ`
          + (res.skipped > 0 ? ` (ข้าม ${res.skipped} รายการที่ไม่ตรงเงื่อนไข)` : ''));
      } else {
        const res = await api.post<BillingConfirmResult>(`/billing/lines/${action}`, { ids });
        setMessage(action === 'confirm'
          ? `Confirm แล้ว ${res.updated.toLocaleString()} รายการ — ย้ายไปหน้า Billing Manday Allocate`
          : `ยกเลิก Confirm แล้ว ${res.updated.toLocaleString()} รายการ — ย้ายกลับไปหน้า Billing Manday Import`
            + (skippedLocked > 0 ? ` (ข้าม ${skippedLocked} รายการที่ Lock แล้ว)` : ''));
      }
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Excel export of the Allocate screen — every line the filters leave (not just the page drawn),
   * in screen order. The server takes the ids, so whatever is filtered here is what lands in the
   * file. Open to every role: it only reads.
   */
  async function exportExcel() {
    if (filtered.length === 0) return;
    const parts: string[] = [];
    if (year != null) parts.push(`ปี ${year}`);
    if (months.size > 0) parts.push(`เดือน ${[...months].sort((a, b) => a - b).map((m) => TH_MONTH[m - 1] ?? m).join(', ')}`);
    if (allocFilter) parts.push(`สถานะ ${ALLOC_STATUS[allocFilter].label}`);
    for (const c of columns) {
      const v = (colFilters[c.key] ?? '').trim();
      if (v) parts.push(`${c.filterLabel ?? (typeof c.label === 'string' ? c.label : c.key)}: ${v}`);
    }
    if (search.trim()) parts.push(`ค้นหา "${search.trim()}"`);

    setExporting(true);
    setError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      await api.download('/billing/lines/export', `billing-manday-allocate-${stamp}.xlsx`,
        { ids: filtered.map((r) => r.id), filterSummary: parts.join(' · ') || null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  }

  const title = isImport ? 'Billing Manday Import' : 'Billing Manday Allocate';

  // Import is Admin only (the menu hides it; this covers a typed URL — the API refuses anyway).
  if (isImport && !isAdmin) {
    return (
      <div className="billing">
        <h1 className="billing__title">{title}</h1>
        <p className="error-text">หน้านี้สำหรับ Admin เท่านั้น — ดูรายการที่ Confirm แล้วได้ที่
          {' '}<Link to="/billing/allocate">Billing Manday Allocate</Link></p>
      </div>
    );
  }

  return (
    <div className="billing">
      <div className="section-head">
        <h1 className="billing__title">{title}</h1>
        <div className="head-actions">
          <RefreshButton onRefresh={() => load()} />
          {readOnly && <span className="badge billing__badge-none" title="ดูได้อย่างเดียว — แก้ไขได้เฉพาะ Admin">👁 View only</span>}
          {!isImport && (
            <button className="btn btn--sm" disabled={exporting || filtered.length === 0} onClick={exportExcel}
              title={`Export ${filtered.length.toLocaleString()} รายการตามตัวกรองบนหน้าจอเป็น Excel`}>
              {exporting ? 'กำลัง Export…' : `⬇ Export Excel (${filtered.length.toLocaleString()})`}
            </button>
          )}
          {isAdmin && (
            <button className="btn btn--sm" disabled={busy || syncing} onClick={syncJobs}
              title={jobCache?.fetchedAt
                ? `ข้อมูล Job ${jobCache.jobs.toLocaleString()} รายการ · ดึงล่าสุด ${fmtDateTime(jobCache.fetchedAt)}`
                : 'ยังไม่เคยดึงข้อมูล Job จาก BC'}>
              {syncing ? 'กำลังดึงจาก BC…' : '⟳ ดึงชื่อ Job / PM จาก BC'}
            </button>
          )}
          {isImport && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';             // allow picking the same file again
                  if (f) importFile(f);
                }} />
              <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? 'กำลังทำงาน…' : '⬆ Import Posted Sales Invoice'}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="muted billing__hint">
        {isImport ? (
          <>
            Import ไฟล์ <b>Posted Sales Invoice Lines</b> ที่ export จาก BC (ข้ามบรรทัดที่ Type ว่าง) แล้วเลือกรายการที่จะ
            {' '}<b>Confirm</b> — รายการที่ Confirm จะย้ายไปหน้า <Link to="/billing/allocate">Billing Manday Allocate</Link> ·
            {' '}Import ซ้ำจะเพิ่มเฉพาะเอกสารที่ยังไม่เคยมีในระบบ (รายการที่ลบไปแล้วจะไม่กลับมา)
          </>
        ) : readOnly ? (
          <>
            รายการ Billing ที่ Confirm แล้ว และการ Allocate Manday ให้แต่ละคน — <b>Billing Manday</b> = Line Amount ÷ เรท Manday
            {' '}ของปีนั้น (ปัด 3 ตำแหน่ง) · <b>โหมดดูอย่างเดียว</b> แก้ไขได้เฉพาะ Admin
          </>
        ) : (
          <>
            รายการที่ Confirm แล้วจากหน้า <Link to="/billing/import">Billing Manday Import</Link> —
            {' '}<b>Billing Manday</b> = Line Amount ÷ เรท Manday ของปีนั้น (ปัด 3 ตำแหน่ง) · ใส่ Manday ของแต่ละคนในตารางด้านขวา
            {' '}(บันทึกเมื่อออกจากช่อง / กด Enter) แล้วดู <b>คงเหลือ</b> ให้เป็น 0 ·
            {' '}กรองคอลัมน์ คงเหลือ ด้วย <code>!=0</code> เพื่อดูรายการที่ยัง Allocate ไม่ครบ ·
            {' '}กด <b>ยกเลิก Confirm</b> เพื่อส่งรายการกลับไปหน้า Import
          </>
        )}
      </p>

      {error && <p className="error-text">{error}</p>}
      {message && <p className="billing__ok">✓ {message}</p>}
      {!isImport && !loading && missingRateYears.length > 0 && (
        <p className="billing__warn">
          ยังไม่ได้กำหนดเรท Manday ของปี <b>{missingRateYears.join(', ')}</b> — รายการของปีนี้จึงยังคำนวณ
          {' '}Billing Manday และ Lock ไม่ได้ ·
          {isAdmin
            ? <> ไปที่ <Link to="/billing/rates">Billing Manday Rate</Link> เพื่อกำหนดเรท</>
            : <> แจ้ง Admin เพื่อกำหนดเรท</>}
        </p>
      )}
      {isAdmin && !isImport && !loading && kpiResources.length === 0 && (
        <p className="billing__warn">
          ยังไม่มี Resource ที่กำหนดให้คิด KPI Billing — ไปที่ <Link to="/resources">Master Resource</Link>
          {' '}แล้วติ๊กช่อง <b>KPI Billing</b> ของคนที่ต้องการ เพื่อให้แสดงเป็นคอลัมน์สำหรับ Allocate
        </p>
      )}
      {/* Name/PM come from a local copy of BC — nudge when it is missing or leaves lines unlabelled. */}
      {isAdmin && rows.length > 0 && unlabelled > 0 && !syncing && (
        <p className="billing__warn">
          มี {unlabelled.toLocaleString()} บรรทัดที่ยังไม่มีชื่อ Job หรือ PM
          {jobCache?.fetchedAt
            ? <> — ข้อมูล Job จาก BC ดึงล่าสุด {fmtDateTime(jobCache.fetchedAt)} ถ้าเพิ่งเพิ่ม Job ใน BC
                ให้กด <b>ดึงชื่อ Job / PM จาก BC</b> อีกครั้ง (Job ที่ BC ไม่ได้ระบุ PM ไว้จะยังว่างอยู่)</>
            : <> — ยังไม่เคยดึงข้อมูล Job จาก BC กด <b>ดึงชื่อ Job / PM จาก BC</b> เพื่ออัปเดต</>}
        </p>
      )}
      {importResult && (
        <div className="billing__result">
          <span className="badge badge--actual">Import {importResult.imported.toLocaleString()} บรรทัด</span>
          <span className="badge badge--budget">เอกสารใหม่ {importResult.documents.toLocaleString()}</span>
          {importResult.skippedExistingDocuments > 0 && (
            <span className="badge badge--blue" title="เอกสารที่มีในระบบอยู่แล้ว (รวมที่ Confirm / ลบไปแล้ว) ไม่ Import ซ้ำ">
              ข้ามเอกสารที่มีอยู่แล้ว {importResult.skippedExistingDocuments.toLocaleString()}
            </span>
          )}
          <span className="badge badge--adjust">ข้าม Type ว่าง {importResult.skippedBlankType.toLocaleString()}</span>
        </div>
      )}

      {years.length === 0 && !loading ? (
        <div className="card billing__empty muted">
          {isImport
            ? <>ไม่มีรายการรอ Confirm — กด <b>Import Posted Sales Invoice</b> แล้วเลือกไฟล์ .xlsx ที่ export จาก BC</>
            : <>ยังไม่มีรายการที่ Confirm — เลือกรายการและกด Confirm ที่หน้า <Link to="/billing/import">Billing Manday Import</Link></>}
        </div>
      ) : (
        <>
          <div className="billing__filterbar">
            <span className="billing__label">ปี:</span>
            {years.map((y) => (
              <button key={y.year} type="button"
                className={`status-chip badge--blue ${year === y.year ? 'is-active' : ''}`}
                aria-pressed={year === y.year} onClick={() => changeYear(y.year)}>
                {y.year} <span className="billing__count">{y.lines.toLocaleString()}</span>
              </button>
            ))}
            <span className="billing__sep" />
            <span className="billing__label">เดือน:</span>
            {TH_MONTH.map((label, i) => {
              const m = i + 1;
              if (!presentMonths.has(m)) return null;
              return (
                <button key={m} type="button"
                  className={`status-chip badge--green ${months.has(m) ? 'is-active' : ''}`}
                  aria-pressed={months.has(m)} onClick={() => toggleMonth(m)}>
                  {label}
                </button>
              );
            })}
            {months.size > 0 && (
              <button type="button" className="btn btn--sm" onClick={() => setMonths(new Set())}>ทุกเดือน</button>
            )}
            <span className="billing__sep" />
            <input className="input billing__search" type="search"
              placeholder="ค้นหาทุกคอลัมน์…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {!isImport && (
            <div className="billing__filterbar">
              <span className="billing__label">สถานะ Allocate:</span>
              {ALLOC_FILTERS.map((f) => (
                <button key={f.key || 'all'} type="button"
                  className={`status-chip ${f.key === 'complete' ? 'badge--green' : f.key === 'partial' ? 'badge--orange' : 'badge--blue'} ${allocFilter === f.key ? 'is-active' : ''}`}
                  aria-pressed={allocFilter === f.key} onClick={() => setAllocFilter(f.key)}>
                  {f.label} <span className="billing__count">{allocCounts[f.key].toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}

          <div className="kpi-grid billing__kpi">
            <div className="statcard">
              <div className="statcard__label">จำนวนบรรทัด</div>
              <div className="statcard__value">{filtered.length.toLocaleString()}</div>
            </div>
            {isImport ? (
              <div className="statcard statcard--blue">
                <div className="statcard__label">Manday (UOM = MD)</div>
                <div className="statcard__value">{qty(kpi.mdQty)}</div>
              </div>
            ) : (
              <div className="statcard statcard--blue">
                <div className="statcard__label">Billing Manday (Line Amount ÷ เรท)</div>
                <div className="statcard__value">{qty(totals.manday ?? 0)}</div>
              </div>
            )}
            <div className="statcard statcard--amber">
              <div className="statcard__label">Line Amount (Excl. VAT)</div>
              <div className="statcard__value">{money(kpi.amount)}</div>
            </div>
            {!isImport && (
              <>
                <div className="statcard statcard--green">
                  <div className="statcard__label">Allocate แล้ว</div>
                  <div className="statcard__value">{qty(totals.allocated ?? 0)}</div>
                </div>
                <div className={`statcard ${(totals.remaining ?? 0) === 0 ? 'statcard--green' : 'statcard--red'}`}>
                  <div className="statcard__label">คงเหลือ (Billing Manday − Allocate)</div>
                  <div className={`statcard__value${(totals.remaining ?? 0) === 0 ? ' under-budget' : ' over-budget'}`}>
                    {qty(totals.remaining ?? 0)}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="billing__bulk">
            <span className="muted">
              แสดง {filtered.length.toLocaleString()} / {rows.length.toLocaleString()} บรรทัด
              {someVisibleSelected && ` · เลือก ${visibleSelected.length.toLocaleString()}`}
            </span>
            {activeColFilters > 0 && (
              <button className="btn btn--sm" onClick={() => setColFilters({})}>
                ✕ ล้างตัวกรองคอลัมน์ ({activeColFilters})
              </button>
            )}
            {readOnly ? null : isImport ? (
              <>
                <button className="btn btn--sm btn--primary" disabled={busy || !someVisibleSelected}
                  onClick={() => bulk('confirm')}>
                  ✓ Confirm ที่เลือก ({visibleSelected.length.toLocaleString()})
                </button>
                <button className="btn btn--sm btn--danger" disabled={busy || !someVisibleSelected}
                  onClick={() => bulk('delete')}>
                  🗑 ลบที่เลือก ({visibleSelected.length.toLocaleString()})
                </button>
              </>
            ) : (
              <>
                <button className="btn btn--sm btn--primary" disabled={busy || unconfirmable.length === 0}
                  title="คำนวณและใส่ค่าให้ Resource เดียวกันทุกบรรทัดที่เลือก (ข้ามรายการที่ Lock แล้ว)"
                  onClick={() => setAutoOpen(true)}>
                  ⚡ Auto Allocate ({unconfirmable.length.toLocaleString()})
                </button>
                <button className="btn btn--sm btn--primary" disabled={busy || lockable.length === 0}
                  title="Lock ได้เฉพาะรายการที่ Allocate ครบ (คงเหลือ = 0)"
                  onClick={() => bulk('lock')}>
                  🔒 Lock ({lockable.length.toLocaleString()})
                </button>
                <button className="btn btn--sm" disabled={busy || unlockable.length === 0}
                  onClick={() => bulk('unlock')}>
                  🔓 Unlock ({unlockable.length.toLocaleString()})
                </button>
                <button className="btn btn--sm" disabled={busy || unconfirmable.length === 0}
                  title="รายการที่ Lock แล้วต้อง Unlock ก่อน"
                  onClick={() => bulk('unconfirm')}>
                  ↩ ยกเลิก Confirm ({unconfirmable.length.toLocaleString()})
                </button>
              </>
            )}
          </div>

          <TopScrollbar target={tableWrapRef} />
          <div className="card billing__tablewrap" ref={tableWrapRef}>
            <table className="table billing__table">
              <thead>
                <tr>
                  {/* No selection in view-only mode: there is nothing a viewer could do with it. */}
                  {!readOnly && (
                    <th className="billing__check"
                      title={`เลือก/ยกเลิกทั้งหมด ${filtered.length.toLocaleString()} บรรทัดตามตัวกรอง (รวมที่ยังไม่ได้แสดง)`}>
                      <input type="checkbox" checked={allVisibleSelected}
                        ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                        onChange={toggleAllVisible} disabled={filtered.length === 0} />
                    </th>
                  )}
                  {columns.map((c) => (
                    <th key={c.key}
                      className={[c.numeric ? 'num' : '', c.headerClassName ?? ''].filter(Boolean).join(' ') || undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
                <tr className="billing__filters">
                  {!readOnly && <th className="billing__check" />}
                  {columns.map((c) => {
                    const name = c.filterLabel ?? String(c.label);
                    return (
                      <th key={c.key} className={c.headerClassName}>
                        <input className="input billing__colfilter" type="search"
                          value={colFilters[c.key] ?? ''}
                          placeholder={c.numeric ? '>0, !=0…' : 'กรอง…'}
                          title={c.numeric ? 'พิมพ์ตัวเลข หรือใช้ > < >= <= = != เช่น >0' : `กรอง ${name}`}
                          aria-label={`กรอง ${name}`}
                          onChange={(e) => setColFilter(c.key, e.target.value)} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={columns.length + (readOnly ? 0 : 1)} className="muted">กำลังโหลด…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={columns.length + (readOnly ? 0 : 1)} className="muted">ไม่พบรายการตามตัวกรอง</td></tr>
                ) : shown.map((r) => (
                  <tr key={r.id} className={[
                    selected.has(r.id) ? 'is-selected' : '',
                    isImport ? '' : `billing__row--${allocStatusOf(r)}`,
                  ].filter(Boolean).join(' ') || undefined}>
                    {!readOnly && (
                      <td className="billing__check">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                      </td>
                    )}
                    {columns.map((c) => {
                      const v = c.value(r);
                      const negative = c.numeric && typeof v === 'number' && v < 0;
                      const cls = [c.numeric ? 'num' : '', c.className ?? '', negative ? 'over-budget' : '']
                        .filter(Boolean).join(' ');
                      return (
                        <td key={c.key} className={cls || undefined}>
                          {c.render ? c.render(r) : (v === null || v === undefined || v === '' ? '—' : v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {!loading && filtered.length > 0 && (
                <tfoot>
                  <tr className="billing__totals">
                    {!readOnly && <td className="billing__check" />}
                    {columns.map((c, i) => {
                      if (!c.sum) {
                        return <td key={c.key} className={c.headerClassName}>
                          {i === 0 ? `รวม ${filtered.length.toLocaleString()} บรรทัด` : ''}
                        </td>;
                      }
                      const v = totals[c.key] ?? 0;
                      const tone = c.key === 'remaining'
                        ? (v === 0 ? ' under-budget' : ' over-budget') : '';
                      // Billing Manday is a 3-decimal figure; keep its total in the same format.
                      if (c.key === 'manday') {
                        return <td key={c.key} className={`num ${c.headerClassName ?? ''}`}>
                          {v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                        </td>;
                      }
                      return (
                        <td key={c.key} className={`num ${c.headerClassName ?? ''}${tone}`}>
                          {c.key === 'amount' ? money(v) : qty(v)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
            {shown.length < filtered.length && (
              <div className="billing__more">
                <span className="muted">
                  แสดง {shown.length.toLocaleString()} จาก {filtered.length.toLocaleString()} บรรทัด
                </span>
                <button className="btn btn--sm" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                  แสดงเพิ่ม {Math.min(PAGE_SIZE, filtered.length - shown.length).toLocaleString()}
                </button>
                <button className="btn btn--sm" onClick={() => setLimit(filtered.length)}
                  title="อาจใช้เวลาสักครู่ถ้ามีหลายพันบรรทัด">
                  แสดงทั้งหมด
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {autoOpen && (
        <AutoAllocateModal
          lines={visibleSelected}
          people={kpiResources}
          evalFormula={evalFormula}
          onClose={() => setAutoOpen(false)}
          onDone={async (msg) => {
            setAutoOpen(false);
            setSelected(new Set());
            setMessage(msg);
            if (yearRef.current != null) await loadLines(yearRef.current);
          }} />
      )}
    </div>
  );
}
