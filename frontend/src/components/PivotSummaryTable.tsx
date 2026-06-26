import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { MandaySummaryCell } from '../api/types';
import './PivotSummaryTable.scss';

export interface PivotRow {
  key: string | number;
  firstCell: ReactNode;
  cells: MandaySummaryCell[];
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// Edge/border accent color per position.
const POS_COLOR: Record<string, string> = {
  Dev: 'var(--color-primary)',      // blue
  SA: 'var(--color-success)',       // green
  PM: 'var(--color-adjust)',        // orange
  'ไม่ระบุ': 'var(--color-danger)',   // red
};

const ORDER = ['Dev', 'SA', 'PM'];
function orderPositions(positions: string[]) {
  return [...positions].sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

interface Props {
  firstColHeader: string;
  rows: PivotRow[];
  isAdmin: boolean;
}

export function PivotSummaryTable({ firstColHeader, rows, isAdmin }: Props) {
  const [adminView, setAdminView] = useState(false);
  const showPm = isAdmin && adminView;

  // Column groups = union of positions present, ordered, minus PM unless Admin View.
  const positions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.cells.forEach((c) => set.add(c.position)));
    const all = orderPositions([...set]);
    return showPm ? all : all.filter((p) => p !== 'PM');
  }, [rows, showPm]);

  // Hide rows that have no data in any currently-shown position.
  const shownRows = useMemo(
    () => rows.filter((r) => r.cells.some((c) => positions.includes(c.position))),
    [rows, positions],
  );

  const totals = useMemo(() => {
    const map: Record<string, { budgetAdjust: number; actual: number; remaining: number }> = {};
    positions.forEach((p) => (map[p] = { budgetAdjust: 0, actual: 0, remaining: 0 }));
    rows.forEach((r) =>
      r.cells.forEach((c) => {
        const t = map[c.position];
        if (t) {
          t.budgetAdjust += c.budgetAdjust;
          t.actual += c.actual;
          t.remaining += c.remaining;
        }
      }),
    );
    return map;
  }, [rows, positions]);

  return (
    <>
      {isAdmin && (
        <div className="pivot__toolbar">
          <label className="pivot__adminview">
            <input type="checkbox" checked={adminView} onChange={(e) => setAdminView(e.target.checked)} />
            Admin View
          </label>
        </div>
      )}

      {positions.length === 0 ? (
        <p className="muted">ยังไม่มีข้อมูล manday</p>
      ) : (
        <div className="card pivot__scroll">
          <table className="table pivot__table">
            <thead>
              <tr>
                <th rowSpan={2} className="pivot__firstcol">{firstColHeader}</th>
                {positions.map((p) => {
                  const color = POS_COLOR[p];
                  return (
                    <th
                      key={p}
                      colSpan={3}
                      className="pivot__group"
                      style={color ? { borderTop: `3px solid ${color}`, color } : undefined}
                    >
                      {p}
                    </th>
                  );
                })}
                <th colSpan={3} className="pivot__group pivot__totalcol">Total</th>
              </tr>
              <tr>
                {positions.map((p) => (
                  <Fragment key={p}>
                    <th className="num">Budget+Adjust</th>
                    <th className="num">Actual</th>
                    <th className="num">Remaining</th>
                  </Fragment>
                ))}
                <th className="num pivot__totalcol">Budget+Adjust</th>
                <th className="num pivot__totalcol">Actual</th>
                <th className="num pivot__totalcol">Remaining</th>
              </tr>
            </thead>
            <tbody>
              <tr className="pivot__totalrow">
                <td className="pivot__firstcol">รวมทั้งหมด</td>
                {positions.map((p) => {
                  const t = totals[p];
                  return (
                    <Fragment key={p}>
                      <td className="num">{fmt(t.budgetAdjust)}</td>
                      <td className="num">{fmt(t.actual)}</td>
                      <td className={`num ${t.remaining < 0 ? 'over-budget' : ''}`}>{fmt(t.remaining)}</td>
                    </Fragment>
                  );
                })}
                {(() => {
                  const g = positions.reduce(
                    (a, p) => ({
                      ba: a.ba + totals[p].budgetAdjust,
                      ac: a.ac + totals[p].actual,
                      rem: a.rem + totals[p].remaining,
                    }),
                    { ba: 0, ac: 0, rem: 0 },
                  );
                  return (
                    <>
                      <td className="num pivot__totalcol">{fmt(g.ba)}</td>
                      <td className="num pivot__totalcol">{fmt(g.ac)}</td>
                      <td className={`num pivot__totalcol ${g.rem < 0 ? 'over-budget' : ''}`}>{fmt(g.rem)}</td>
                    </>
                  );
                })()}
              </tr>

              {shownRows.map((r) => {
                const byPos = new Map(r.cells.map((c) => [c.position, c]));
                return (
                  <tr key={r.key}>
                    <td className="pivot__firstcol">{r.firstCell}</td>
                    {positions.map((p) => {
                      const c = byPos.get(p);
                      if (!c) {
                        return (
                          <Fragment key={p}>
                            <td className="num muted">—</td>
                            <td className="num muted">—</td>
                            <td className="num muted">—</td>
                          </Fragment>
                        );
                      }
                      return (
                        <Fragment key={p}>
                          <td className="num">{fmt(c.budgetAdjust)}</td>
                          <td className="num">{fmt(c.actual)}</td>
                          <td className={`num ${c.remaining < 0 ? 'over-budget' : ''}`}>{fmt(c.remaining)}</td>
                        </Fragment>
                      );
                    })}
                    {(() => {
                      const rt = r.cells
                        .filter((c) => positions.includes(c.position))
                        .reduce(
                          (a, c) => ({
                            ba: a.ba + c.budgetAdjust,
                            ac: a.ac + c.actual,
                            rem: a.rem + c.remaining,
                          }),
                          { ba: 0, ac: 0, rem: 0 },
                        );
                      return (
                        <>
                          <td className="num pivot__totalcol">{fmt(rt.ba)}</td>
                          <td className="num pivot__totalcol">{fmt(rt.ac)}</td>
                          <td className={`num pivot__totalcol ${rt.rem < 0 ? 'over-budget' : ''}`}>{fmt(rt.rem)}</td>
                        </>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
