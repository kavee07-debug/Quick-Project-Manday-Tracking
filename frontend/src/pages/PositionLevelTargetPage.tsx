import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { RESOURCE_POSITIONS, type PositionLevel } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PositionBadge } from '../components/PositionBadge';
import { RefreshButton } from '../components/RefreshButton';
import './BillingPage.scss';

/** One target cell: typed in place, saved on blur / Enter; blank clears that year's target. */
function TargetCell({ value, save }: { value: number | undefined; save: (v: number | null) => Promise<void> }) {
  const shown = value == null ? '' : String(value);
  const [text, setText] = useState(shown);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(shown); }, [shown]);

  async function commit() {
    const t = text.replace(/,/g, '').trim();
    const next = t === '' ? null : Number(t);
    if (next !== null && (!Number.isFinite(next) || next < 0)) { setText(shown); return; }
    if (next === (value ?? null)) return;
    setSaving(true);
    try { await save(next); } catch { setText(shown); } finally { setSaving(false); }
  }

  return (
    <input className="input poslevel__target" inputMode="decimal" value={text} disabled={saving}
      placeholder="—" aria-label="Manday Target"
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

/**
 * Position Level Manday Target — manday target per person at each Position Level, per year
 * (levels × years). The Billing KPI Manday screen compares each resource's allocated manday with
 * the target of their level. Admin only; the levels themselves are kept on Master Position Level.
 */
export default function PositionLevelTargetPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const [levels, setLevels] = useState<PositionLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extraYears, setExtraYears] = useState<number[]>([]);   // added on screen, no target yet

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLevels(await api.get<PositionLevel[]>('/position-levels'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Every year that has a target, plus this year and any added on screen.
  const years = useMemo(() => {
    const ys = new Set<number>([new Date().getFullYear(), ...extraYears]);
    for (const l of levels) for (const y of Object.keys(l.targets)) ys.add(Number(y));
    return [...ys].sort((a, b) => a - b);
  }, [levels, extraYears]);

  const groups = useMemo(() => RESOURCE_POSITIONS
    .map((p) => ({ position: p, levels: levels.filter((l) => l.position === p) }))
    .filter((g) => g.levels.length > 0), [levels]);

  async function saveTarget(l: PositionLevel, year: number, value: number | null) {
    setError(null);
    try {
      await api.put(`/position-levels/${encodeURIComponent(l.position)}/${encodeURIComponent(l.code)}/targets/${year}`,
        { targetManday: value });
      setLevels((prev) => prev.map((x) => {
        if (x.position !== l.position || x.code !== l.code) return x;
        const targets = { ...x.targets };
        if (value == null) delete targets[year]; else targets[year] = value;
        return { ...x, targets };
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึก Target ไม่สำเร็จ');
      throw err;
    }
  }

  // Admin only (the menu hides it; this covers a typed URL — the API refuses anyway).
  if (!isAdmin) {
    return (
      <div className="billing">
        <h1 className="billing__title">Position Level Manday Target</h1>
        <p className="error-text">หน้านี้สำหรับ Admin เท่านั้น — ดู Target เทียบกับยอด Allocate ได้ที่หน้า
          {' '}<Link to="/billing/kpi">Billing KPI Manday</Link></p>
      </div>
    );
  }

  return (
    <div className="billing">
      <div className="section-head">
        <h1 className="billing__title">Position Level Manday Target</h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
          <button className="btn" onClick={() => setExtraYears((prev) => [...prev, Math.max(...years) + 1])}>
            + เพิ่มปี {Math.max(...years) + 1}
          </button>
        </div>
      </div>
      <p className="muted billing__hint">
        เป้าหมาย Manday <b>ต่อคนต่อปี</b> ของแต่ละ Position Level — ใช้เทียบกับยอด Allocate ในหน้า
        {' '}<Link to="/billing/kpi">Billing KPI Manday</Link> · พิมพ์ตัวเลขแล้วกด Enter เพื่อบันทึก, ลบให้ว่างเพื่อยกเลิก Target ของปีนั้น ·
        {' '}เพิ่ม/แก้ Level ได้ที่ <Link to="/position-levels">Master Position Level</Link>
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card billing__kpitable">
        <table className="table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Resource</th>
              {years.map((y) => <th key={y} className="num billing__kpi-ystart">{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4 + years.length} className="muted">กำลังโหลด…</td></tr>
            ) : levels.length === 0 ? (
              <tr><td colSpan={4 + years.length} className="muted">
                ยังไม่มี Level — เพิ่มที่ <Link to="/position-levels">Master Position Level</Link> ก่อน
              </td></tr>
            ) : groups.map((g) => (
              <Fragment key={g.position}>
                {g.levels.map((l) => (
                  <tr key={`${l.position}|${l.code}`}>
                    <td><PositionBadge position={l.position} /></td>
                    <td><b>{l.code}</b></td>
                    <td>{l.name}</td>
                    <td className="num">{l.resources > 0 ? l.resources.toLocaleString() : <span className="muted">—</span>}</td>
                    {years.map((y) => (
                      <td key={y} className="num billing__kpi-ystart">
                        <TargetCell value={l.targets[y]} save={(v) => saveTarget(l, y, v)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
