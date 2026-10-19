import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { RESOURCE_POSITIONS, type PositionLevel } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { PositionBadge } from '../components/PositionBadge';
import { RefreshButton } from '../components/RefreshButton';
import './BillingPage.scss';

/**
 * Master Position Level — the levels within each Position (Dev / SA / PM) that resources are
 * assigned to on the Master Resource page. Kept by Admin / ProjectManager. The manday target per
 * level per year lives on its own screen (Position Level Manday Target).
 */
export default function PositionLevelPage() {
  const { isManager, hasRole } = useAuth();
  const isAdmin = hasRole('Admin');
  const [levels, setLevels] = useState<PositionLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ position: string; code: string; name: string; existing: boolean } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = { position: form.position, code: form.code, name: form.name };
      if (form.existing) await api.put(`/position-levels/${encodeURIComponent(form.position)}/${encodeURIComponent(form.code)}`, body);
      else await api.post('/position-levels', body);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(l: PositionLevel) {
    const years = Object.keys(l.targets).length;
    if (!window.confirm(`ลบ Level ${l.position} / ${l.code} (${l.name})?`
      + (years > 0 ? `\nManday Target ของ Level นี้ ${years} ปีจะถูกลบด้วย` : ''))) return;
    setError(null);
    try {
      await api.del(`/position-levels/${encodeURIComponent(l.position)}/${encodeURIComponent(l.code)}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  const colSpan = isManager ? 5 : 4;

  return (
    <div className="billing">
      <div className="section-head">
        <h1 className="billing__title">Master Position Level</h1>
        <div className="head-actions">
          <RefreshButton onRefresh={load} />
          {isManager && (
            <button className="btn btn--primary"
              onClick={() => { setForm({ position: 'SA', code: '', name: '', existing: false }); setFormError(null); }}>
              + เพิ่ม Level
            </button>
          )}
        </div>
      </div>
      <p className="muted billing__hint">
        Level ของแต่ละ Position — กำหนดให้ Resource ได้ที่ <Link to="/resources">Master Resource</Link>
        {isAdmin && <> · Manday Target ของแต่ละ Level กำหนดที่ <Link to="/position-level-targets">Position Level Manday Target</Link></>}
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="card billing__ratetable">
        <table className="table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Resource</th>
              {isManager && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} className="muted">กำลังโหลด…</td></tr>
            ) : levels.length === 0 ? (
              <tr><td colSpan={colSpan} className="muted">ยังไม่มี Level{isManager && ' — กด “+ เพิ่ม Level”'}</td></tr>
            ) : levels.map((l) => (
              <tr key={`${l.position}|${l.code}`}>
                <td><PositionBadge position={l.position} /></td>
                <td><b>{l.code}</b></td>
                <td>{l.name}</td>
                <td className="num">{l.resources > 0 ? l.resources.toLocaleString() : <span className="muted">—</span>}</td>
                {isManager && (
                  <td className="num">
                    <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--sm"
                        onClick={() => { setForm({ position: l.position, code: l.code, name: l.name, existing: true }); setFormError(null); }}>
                        แก้ไข
                      </button>
                      <button className="btn btn--sm btn--danger" disabled={l.resources > 0}
                        title={l.resources > 0 ? 'มี Resource ใช้ Level นี้อยู่ — ลบไม่ได้' : undefined}
                        onClick={() => remove(l)}>ลบ</button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.existing ? `แก้ไข Level ${form.position} / ${form.code}` : 'เพิ่ม Position Level'}
          onClose={() => setForm(null)}>
          <form onSubmit={save}>
            <label className="field-label">Position</label>
            <select className="input" value={form.position} disabled={form.existing}
              onChange={(e) => setForm({ ...form, position: e.target.value })}>
              {RESOURCE_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <label className="field-label">Code</label>
            <input className="input" value={form.code} disabled={form.existing} maxLength={20}
              placeholder="เช่น JR, SR, LEAD" onChange={(e) => setForm({ ...form, code: e.target.value })} required />

            <label className="field-label">Name</label>
            <input className="input" value={form.name} maxLength={100} autoFocus={form.existing}
              placeholder="เช่น Senior SA" onChange={(e) => setForm({ ...form, name: e.target.value })} required />

            {form.existing && <p className="muted billing__hint">Position และ Code เป็นคีย์ — แก้ได้เฉพาะ Name</p>}
            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setForm(null)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
