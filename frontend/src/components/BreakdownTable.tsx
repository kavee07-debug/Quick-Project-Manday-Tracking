import { useState } from 'react';
import type { BreakdownRow } from '../api/types';

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

type SortKey = 'job' | 'task' | 'resource' | 'ba' | 'actual' | 'remaining' | 'remark';
function sortVal(g: Group, key: SortKey): string | number {
  switch (key) {
    case 'job': return g.projectCode;
    case 'task': return g.taskName;
    case 'resource': return g.resourceName ?? '';
    case 'ba': return g.budgetAdjust;
    case 'actual': return g.actual;
    case 'remaining': return g.budgetAdjust - g.actual;
    case 'remark': return g.notes.join(' · ');
  }
}

// One aggregated line: the manday rows for a given task + resource, pivoted into
// Budget+Adjust / Actual / Remaining (mirrors the summary pivot's three columns).
interface Group {
  projectCode: string;
  projectName: string;
  taskName: string;
  taskDescription?: string | null;
  resourceName?: string | null;
  notes: string[];
  budgetAdjust: number;
  actual: number;
}

// Table behind a clicked pivot number — grouped by task + resource, showing the
// same Budget+Adjust / Actual / Remaining breakdown as the summary. Used both
// inline (expand/collapse) and inside BreakdownModal.
export function BreakdownTable({ rows, maxHeight = '60vh', accent = false, hideJob = false }: {
  rows: BreakdownRow[];
  maxHeight?: string;
  accent?: boolean;
  hideJob?: boolean;   // drill-down under a single project already names the Job — drop the column
}) {
  // Click a header to sort; click again to flip direction. Null = default order.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const onSort = (key: SortKey) =>
    setSort((p) => (p?.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  // Show the Resource column only when the breakdown carries it (Manday Summary page).
  const showResource = rows.some((r) => r.resourceName != null);

  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.projectCode}|${r.taskName}|${r.resourceName ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        projectCode: r.projectCode, projectName: r.projectName,
        taskName: r.taskName, taskDescription: r.taskDescription,
        resourceName: r.resourceName, notes: [], budgetAdjust: 0, actual: 0,
      };
      groups.set(key, g);
    }
    if (r.entryType.toLowerCase() === 'actual') g.actual += r.manday;
    else g.budgetAdjust += r.manday;                       // Budget + Adjust
    if (r.note && !g.notes.includes(r.note)) g.notes.push(r.note);
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (sort) {
      const va = sortVal(a, sort.key);
      const vb = sortVal(b, sort.key);
      const c = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true });
      if (c !== 0) return sort.dir === 'asc' ? c : -c;
    }
    // Fall back to the default Job → Task order (also the tie-breaker when sorting).
    return a.projectCode.localeCompare(b.projectCode, undefined, { numeric: true })
      || a.taskName.localeCompare(b.taskName, undefined, { numeric: true });
  });

  const tot = sorted.reduce(
    (a, g) => ({ ba: a.ba + g.budgetAdjust, ac: a.ac + g.actual }),
    { ba: 0, ac: 0 },
  );
  // Column order: [Job,] Task, [Resource,] Budget+Adjust, Actual, Remaining, Remark.
  // Remark is free text and goes last so it never pushes the numeric columns right.
  const leftCount = (hideJob ? 0 : 1) + 1 + (showResource ? 1 : 0);   // label cols before the numbers
  const cols = leftCount + 4;                                          // + 3 numeric + Remark
  const numCls = `num${accent ? ' bd__num' : ''}`;

  // Sortable header: click to sort, caret shows the active key + direction.
  const caret = (key: SortKey) => (sort?.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const th = (key: SortKey, label: string, cls = '') => (
    <th className={`bd__sort${cls ? ` ${cls}` : ''}`} onClick={() => onSort(key)} title="คลิกเพื่อเรียงลำดับ">
      {label}{caret(key)}
    </th>
  );

  return (
    <div className="card" style={{ maxHeight, overflowY: 'auto' }}>
      <table className="table bd">
        <thead>
          <tr>
            {!hideJob && th('job', 'Job')}
            {th('task', 'Task')}
            {showResource && th('resource', 'Resource')}
            {th('ba', 'Budget+Adjust', numCls)}
            {th('actual', 'Actual', numCls)}
            {th('remaining', 'Remaining', numCls)}
            {th('remark', 'Remark')}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={cols} className="muted">ไม่มีรายการ</td></tr>
          ) : (
            sorted.map((g, i) => {
              const rem = g.budgetAdjust - g.actual;
              return (
                <tr key={i}>
                  {!hideJob && <td><b className="nowrap">{g.projectCode}</b> <span className="muted">{g.projectName}</span></td>}
                  <td>
                    <b className="nowrap">{g.taskName}</b>
                    {g.taskDescription && <span className="muted"> {g.taskDescription}</span>}
                  </td>
                  {showResource && <td>{g.resourceName ?? <span className="muted">ไม่ระบุ</span>}</td>}
                  <td className={numCls}>{fmt(g.budgetAdjust)}</td>
                  <td className={numCls}>{fmt(g.actual)}</td>
                  <td className={`${numCls}${rem < 0 ? ' over-budget' : ''}`}>{fmt(rem)}</td>
                  <td>{g.notes.length ? g.notes.join(' · ') : <span className="muted">—</span>}</td>
                </tr>
              );
            })
          )}
        </tbody>
        {sorted.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={leftCount} className="num"><b>รวม</b></td>
              <td className={numCls}><b>{fmt(tot.ba)}</b></td>
              <td className={numCls}><b>{fmt(tot.ac)}</b></td>
              <td className={`${numCls}${tot.ba - tot.ac < 0 ? ' over-budget' : ''}`}><b>{fmt(tot.ba - tot.ac)}</b></td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
