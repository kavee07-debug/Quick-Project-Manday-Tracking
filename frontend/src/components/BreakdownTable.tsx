import type { BreakdownRow } from '../api/types';

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
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

  const sorted = [...groups.values()].sort(
    (a, b) => a.projectCode.localeCompare(b.projectCode, undefined, { numeric: true })
      || a.taskName.localeCompare(b.taskName, undefined, { numeric: true }),
  );

  const tot = sorted.reduce(
    (a, g) => ({ ba: a.ba + g.budgetAdjust, ac: a.ac + g.actual }),
    { ba: 0, ac: 0 },
  );
  // Column order: [Job,] Task, [Resource,] Budget+Adjust, Actual, Remaining, Remark.
  // Remark is free text and goes last so it never pushes the numeric columns right.
  const leftCount = (hideJob ? 0 : 1) + 1 + (showResource ? 1 : 0);   // label cols before the numbers
  const cols = leftCount + 4;                                          // + 3 numeric + Remark
  const numCls = `num${accent ? ' bd__num' : ''}`;

  return (
    <div className="card" style={{ maxHeight, overflowY: 'auto' }}>
      <table className="table bd">
        <thead>
          <tr>
            {!hideJob && <th>Job</th>}
            <th>Task</th>
            {showResource && <th>Resource</th>}
            <th className={numCls}>Budget+Adjust</th>
            <th className={numCls}>Actual</th>
            <th className={numCls}>Remaining</th>
            <th>Remark</th>
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
