import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { PROJECT_TYPES, type Project, type ResourceTimelineRow } from '../api/types';
import { JobFilter } from '../components/JobFilter';
import { RefreshButton } from '../components/RefreshButton';
import './ResourceTimelinePage.scss';

const TYPE_CHIP: Record<string, string> = {
  Implement: 'badge--blue', Customize: 'badge--orange', Training: 'badge--purple', Internal: '', MA: 'badge--green', Other: '',
};
// Resource Position → chip colour (matches the bar colours below).
const POS_CHIP: Record<string, string> = {
  Dev: 'badge--blue', SA: 'badge--green', PM: 'badge--orange', 'ไม่ระบุ': 'badge--red',
};
// Bar colour by the resource's Position (mirrors the summary pivot accents).
const POS_COLOR: Record<string, string> = {
  Dev: 'var(--color-primary)', SA: 'var(--color-success)', PM: 'var(--color-adjust)', 'ไม่ระบุ': 'var(--color-danger)',
};

const DAY_W = 30;      // px per calendar day
const NAME_W = 240;    // px, sticky resource column
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function parseISO(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function toISO(dt: Date) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function addDays(dt: Date, n: number) { const c = new Date(dt); c.setDate(c.getDate() + n); return c; }
function fmtDM(dt: Date) { return `${dt.getDate()}/${dt.getMonth() + 1}`; }
function fmt1(n: number) { return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }

export default function ResourceTimelinePage() {
  const [rows, setRows] = useState<ResourceTimelineRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [jobFilter, setJobFilter] = useState<Set<string>>(new Set());
  const [posFilter, setPosFilter] = useState<Set<string>>(new Set());   // resource Position (client-side)

  const todayISO = useMemo(() => toISO(new Date()), []);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of PROJECT_TYPES) c[t] = 0;
    for (const p of projects) if (p.type) c[p.type] = (c[p.type] ?? 0) + 1;
    return c;
  }, [projects]);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (typeFilter.size > 0) params.set('types', [...typeFilter].join(','));
    if (jobFilter.size > 0) params.set('jobs', [...jobFilter].join(','));
    params.set('start', todayISO);
    return `?${params.toString()}`;
  }, [typeFilter, jobFilter, todayISO]);

  // Kept as a callable so the Refresh button re-runs the same query with the current filters.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.get<ResourceTimelineRow[]>(`/resource-timeline${qs}`));
      setError(null);
      // Project list only feeds the filter-chip counts — a failure there must not blank the page.
      api.get<Project[]>('/projects').then(setProjects).catch(() => {/* counts best-effort */});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  function toggle(setFilter: typeof setTypeFilter, value: string) {
    setFilter((cur) => {
      const next = new Set(cur);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  // Position filter options (distinct positions present, with resource counts), in a stable order.
  const posOptions = useMemo(() => {
    const order = ['Dev', 'SA', 'PM', 'ไม่ระบุ'];
    const counts: Record<string, number> = {};
    rows.forEach((r) => { counts[r.position] = (counts[r.position] ?? 0) + 1; });
    return Object.keys(counts).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    }).map((p) => ({ pos: p, count: counts[p] }));
  }, [rows]);

  const visibleRows = useMemo(
    () => (posFilter.size === 0 ? rows : rows.filter((r) => posFilter.has(r.position))),
    [rows, posFilter],
  );

  // Working-day axis (Mon–Fri only, weekends dropped): first working day from today → latest block end.
  // `dayIndex` maps a date (ISO) to its column, so bars land on the right working-day column.
  const { days, dayIndex } = useMemo(() => {
    let s = parseISO(todayISO);
    while (s.getDay() === 0 || s.getDay() === 6) s = addDays(s, 1);   // roll to first weekday
    let max = s;
    visibleRows.forEach((r) => r.blocks.forEach((b) => { const e = parseISO(b.endDate); if (e > max) max = e; }));
    const list: Date[] = [];
    for (let d = s; d <= max; d = addDays(d, 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) list.push(d);
    }
    if (list.length === 0) list.push(s);
    const idx = new Map<string, number>();
    list.forEach((d, i) => idx.set(toISO(d), i));
    return { days: list, dayIndex: idx };
  }, [visibleRows, todayISO]);

  const trackW = days.length * DAY_W;

  // Group the axis days into month bands for the header (label = Thai month + year).
  const monthGroups = useMemo(() => {
    const groups: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = `${TH_MONTH[d.getMonth()]} ${d.getFullYear()}`;
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.span += 1;
      else groups.push({ label, span: 1 });
    }
    return groups;
  }, [days]);

  return (
    <div className="rtl">
      <div className="section-head">
        <h1 className="rtl__title">Resource Timeline</h1>
        <RefreshButton onRefresh={load} />
      </div>
      <p className="muted rtl__hint">
        คาดการณ์คิวงานของแต่ละ resource จากงานที่ยังเหลือ (Budget+Adjust &gt; Actual) เฉพาะ Job สถานะ Open ·
        1 manday = 1 วันทำงาน (จ–ศ) · เริ่มจากวันนี้ ทำทีละงานเรียงต่อกัน · โปรเจกต์ขึ้นต้นด้วย Z จัดไว้ท้ายสุด
      </p>

      <div className="msummary__filterbar">
        <span className="msummary__filterbar-label">ประเภท:</span>
        {PROJECT_TYPES.map((t) => {
          const active = typeFilter.has(t);
          return (
            <button key={t} type="button"
              className={`status-chip ${TYPE_CHIP[t] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active} onClick={() => toggle(setTypeFilter, t)}>
              <span className="status-chip__name">{t}</span>
              <span className="status-chip__count">{typeCounts[t] ?? 0}</span>
            </button>
          );
        })}

        <span className="msummary__filterbar-sep" aria-hidden="true" />

        <span className="msummary__filterbar-label">ตำแหน่ง:</span>
        {posOptions.map(({ pos, count }) => {
          const active = posFilter.has(pos);
          return (
            <button key={pos} type="button"
              className={`status-chip ${POS_CHIP[pos] ?? ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active} onClick={() => toggle(setPosFilter, pos)}>
              <span className="status-chip__name">{pos}</span>
              <span className="status-chip__count">{count}</span>
            </button>
          );
        })}

        <span className="msummary__filterbar-sep" aria-hidden="true" />

        <JobFilter projects={projects} selected={jobFilter} onChange={setJobFilter} />

        {(typeFilter.size > 0 || jobFilter.size > 0 || posFilter.size > 0) && (
          <button type="button" className="btn btn--sm"
            onClick={() => { setTypeFilter(new Set()); setJobFilter(new Set()); setPosFilter(new Set()); }}>
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted">กำลังโหลด…</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : visibleRows.length === 0 ? (
        <p className="muted">ไม่มีงานค้างตามเงื่อนไข</p>
      ) : (
        <div className="card rtl__wrap">
          <div className="rtl__grid" style={{ ['--namew' as string]: `${NAME_W}px` }}>
            {/* Header: month band + day axis */}
            <div className="rtl__head">
              <div className="rtl__namecell rtl__namecell--head">Resource</div>
              <div className="rtl__axiswrap">
                <div className="rtl__monthaxis" style={{ width: trackW }}>
                  {monthGroups.map((g, i) => (
                    <div key={i} className="rtl__monthcell" style={{ width: g.span * DAY_W }} title={g.label}>
                      {g.label}
                    </div>
                  ))}
                </div>
                <div className="rtl__axis" style={{ width: trackW }}>
                {days.map((d, i) => {
                  const cls = `rtl__daycol${d.getDay() === 1 ? ' rtl__daycol--wk' : ''}${i === 0 ? ' rtl__daycol--today' : ''}`;
                  return (
                    <div key={i} className={cls} style={{ width: DAY_W }} title={toISO(d)}>
                      <span className="rtl__dow">{TH_DOW[d.getDay()]}</span>
                      <span className="rtl__dnum">{d.getDate() === 1 ? fmtDM(d) : d.getDate()}</span>
                    </div>
                  );
                })}
                </div>
              </div>
            </div>

            {/* Body: one row per resource */}
            {visibleRows.map((r) => (
              <div className="rtl__row" key={r.resourceId}>
                <div className="rtl__namecell">
                  <div className="rtl__resname"><b>{r.code}</b> <span className="muted">{r.name}</span></div>
                  <div className="rtl__resmeta">
                    <span className="rtl__pos">{r.position}</span>
                    <span className="muted"> · เหลือ {fmt1(r.totalRemaining)} md</span>
                  </div>
                </div>
                <div className="rtl__track" style={{ width: trackW }}>
                  {/* today marker (first working-day column) + week separators */}
                  <div className="rtl__bg rtl__bg--today" style={{ left: 0, width: DAY_W }} />
                  {days.map((d, i) => (d.getDay() === 1 && i !== 0
                    ? <div key={i} className="rtl__bg rtl__bg--wk" style={{ left: i * DAY_W, width: DAY_W }} />
                    : null))}
                  {/* task bars — positioned by working-day column index */}
                  {r.blocks.map((b, i) => {
                    const idxStart = dayIndex.get(b.startDate) ?? 0;
                    const idxEnd = dayIndex.get(b.endDate) ?? idxStart;
                    const left = idxStart * DAY_W;
                    const width = (idxEnd - idxStart + 1) * DAY_W;
                    const color = POS_COLOR[r.position] ?? 'var(--color-primary)';
                    return (
                      <div key={i}
                        className={`rtl__bar${b.isZ ? ' rtl__bar--z' : ''}`}
                        style={{ left, width, ['--bar' as string]: color }}
                        title={`${b.projectCode} · ${b.projectName}\n${b.taskName}${b.taskDescription ? ` — ${b.taskDescription}` : ''}\nเหลือ ${fmt1(b.remainingManday)} md (${b.workingDays} วัน) · ${b.startDate} → ${b.endDate}`}>
                        <span className="rtl__barlabel">{b.projectCode} · {b.taskName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
