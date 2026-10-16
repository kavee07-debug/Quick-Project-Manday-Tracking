import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { BillingBulkAllocateResult, BillingLine, BillingResource } from '../api/types';
import { Modal } from '../components/Modal';

type Mode = 'formula' | 'fixed' | 'remaining';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt3 = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const PRESETS = ['/2', '/3', '/4', '*0.5', '*0.3', '*0.2'];
const OTHER = 'other';

/**
 * Auto Allocate — writes one target (a KPI resource's cell, or Other) on every selected line:
 *  - formula:   each line's Billing Manday through an operation, e.g. "/2" or "*0.5"
 *  - fixed:     the same value on every line ("=…" formulas allowed)
 *  - remaining: whatever the line still has left, added to the target's current value
 * Locked lines, and (for formula/remaining) lines whose year has no rate, are skipped.
 * The figures are worked out here and previewed before anything is sent.
 */
export default function AutoAllocateModal({ lines, people, evalFormula, onClose, onDone }: {
  lines: BillingLine[];
  people: BillingResource[];
  evalFormula: (src: string) => number | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [target, setTarget] = useState<string>(people[0] ? String(people[0].resourceId) : OTHER);
  const [mode, setMode] = useState<Mode>('formula');
  const [formula, setFormula] = useState('/2');
  const [fixed, setFixed] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = (r: BillingLine) => (target === OTHER ? r.otherQuantity : r.allocations?.[target]) ?? null;
  const allocated = (r: BillingLine) =>
    round3(Object.values(r.allocations ?? {}).reduce((s, q) => s + q, 0) + (r.otherQuantity ?? 0));

  // The operation the formula mode applies, e.g. "/2"; a leading "=" is tolerated.
  const op = formula.trim().replace(/^=/, '');
  const opValid = /^[*/+\-x×÷]/.test(op) && evalFormula(`1${op}`) != null;
  const fixedRaw = fixed.trim();
  const fixedValue = fixedRaw === '' ? null
    : fixedRaw.startsWith('=') ? evalFormula(fixedRaw.slice(1))
    : Number.isNaN(Number(fixedRaw.replace(/,/g, ''))) ? null : Number(fixedRaw.replace(/,/g, ''));

  /** Each line's outcome: the new value, or why it is skipped. Cheap enough to redo every render. */
  const plan = lines.map((r) => {
    if (r.isAllocLocked) return { r, skip: 'Lock แล้ว' as const, next: null };
    if (mode === 'fixed') {
      return fixedValue == null ? { r, skip: null, next: null } : { r, skip: null, next: round3(fixedValue) };
    }
    if (r.billingManday == null) return { r, skip: 'ไม่มีเรทปีนี้' as const, next: null };
    if (mode === 'formula') {
      const v = opValid ? evalFormula(`(${r.billingManday})${op}`) : null;
      return { r, skip: null, next: v == null ? null : round3(v) };
    }
    // remaining: top the target up by whatever the line has left
    const left = round3(r.billingManday - allocated(r));
    return { r, skip: null, next: round3((current(r) ?? 0) + left) };
  });

  const toApply = plan.filter((p) => !p.skip && p.next != null);
  const skipped = plan.filter((p) => p.skip);
  const targetName = target === OTHER ? 'Other' : people.find((p) => String(p.resourceId) === target)?.name ?? '';
  const inputOk = mode === 'formula' ? opValid : mode === 'fixed' ? fixedValue != null : true;

  async function apply(e: FormEvent) {
    e.preventDefault();
    if (toApply.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<BillingBulkAllocateResult>('/billing/lines/allocate-bulk', {
        resourceId: target === OTHER ? null : Number(target),
        other: target === OTHER,
        items: toApply.map((p) => ({ lineId: p.r.id, quantity: p.next })),
      });
      onDone(`Auto Allocate ให้ ${targetName} แล้ว ${res.updated.toLocaleString()} รายการ`
        + (res.skipped + skipped.length > 0 ? ` (ข้าม ${res.skipped + skipped.length} รายการ)` : ''));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Auto Allocate ไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <Modal title={`⚡ Auto Allocate — ${lines.length.toLocaleString()} รายการที่เลือก`} onClose={onClose}
      className="modal--wide">
      <form onSubmit={apply} className="autoalloc">
        <label className="field-label">Assign ให้ (ครั้งละ 1 Resource)</label>
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {people.map((p) => (
            <option key={p.resourceId} value={p.resourceId}>{p.name}{p.position ? ` (${p.position})` : ''}</option>
          ))}
          <option value={OTHER}>Other (นอกเหนือ Resource ในระบบ)</option>
        </select>

        <label className="field-label">วิธีคำนวณ</label>
        <div className="autoalloc__modes">
          <label className="autoalloc__mode">
            <input type="radio" name="mode" checked={mode === 'formula'} onChange={() => setMode('formula')} />
            สูตรจาก Billing Manday ของแต่ละบรรทัด
          </label>
          <label className="autoalloc__mode">
            <input type="radio" name="mode" checked={mode === 'fixed'} onChange={() => setMode('fixed')} />
            Fix ค่า (เท่ากันทุกบรรทัด)
          </label>
          <label className="autoalloc__mode">
            <input type="radio" name="mode" checked={mode === 'remaining'} onChange={() => setMode('remaining')} />
            ใส่คงเหลือทั้งหมดของบรรทัด
          </label>
        </div>

        {mode === 'formula' && (
          <>
            <div className="autoalloc__row">
              <span className="muted">Billing Manday</span>
              <input className={`input autoalloc__op${opValid ? '' : ' is-error'}`} value={formula} autoFocus
                placeholder="/2 หรือ *0.5" onChange={(e) => setFormula(e.target.value)} />
            </div>
            <div className="autoalloc__presets">
              {PRESETS.map((p) => (
                <button key={p} type="button" className={`btn btn--sm${formula === p ? ' btn--primary' : ''}`}
                  onClick={() => setFormula(p)}>{p}</button>
              ))}
            </div>
            {!opValid && <p className="error-text">สูตรต้องขึ้นต้นด้วยเครื่องหมาย เช่น /2, *0.5, *0.25</p>}
          </>
        )}
        {mode === 'fixed' && (
          <>
            <input className={`input${fixedRaw && fixedValue == null ? ' is-error' : ''}`} value={fixed} autoFocus
              placeholder="เช่น 0.5 หรือ =1/3" onChange={(e) => setFixed(e.target.value)} />
            {fixedRaw && fixedValue == null && <p className="error-text">ตัวเลข / สูตรไม่ถูกต้อง</p>}
          </>
        )}
        {mode === 'remaining' && (
          <p className="muted autoalloc__note">
            ค่าใหม่ = ค่าเดิมของ {targetName} + คงเหลือของบรรทัด — บรรทัดจะ Allocate ครบพอดี
          </p>
        )}

        <div className="autoalloc__preview">
          <table className="table">
            <thead>
              <tr>
                <th>Document No.</th>
                <th>Job</th>
                <th className="num">Billing Manday</th>
                <th className="num">{targetName} เดิม</th>
                <th className="num">{targetName} ใหม่</th>
              </tr>
            </thead>
            <tbody>
              {plan.slice(0, 50).map(({ r, skip, next }) => (
                <tr key={r.id} className={skip ? 'muted' : undefined}>
                  <td className="nowrap">{r.documentNo}</td>
                  <td className="nowrap">{r.projectNo ?? '—'}</td>
                  <td className="num">{fmt3(r.billingManday)}</td>
                  <td className="num">{fmt3(current(r))}</td>
                  <td className="num">{skip ? <span className="muted">ข้าม — {skip}</span> : <b>{fmt3(next)}</b>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.length > 50 && <p className="muted">… และอีก {(plan.length - 50).toLocaleString()} รายการ</p>}
        </div>

        <p className="autoalloc__summary">
          จะ Assign ให้ <b>{targetName}</b> {toApply.length.toLocaleString()} รายการ
          {skipped.length > 0 && <span className="muted"> · ข้าม {skipped.length} รายการ (Lock แล้ว / ไม่มีเรท)</span>}
          {' '}— <span className="muted">ค่าเดิมของ {targetName} ในบรรทัดเหล่านี้จะถูกแทนที่ คนอื่นไม่เปลี่ยน</span>
        </p>

        {error && <p className="error-text">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !inputOk || toApply.length === 0}>
            {busy ? 'กำลัง Allocate…' : `⚡ Allocate ${toApply.length.toLocaleString()} รายการ`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
