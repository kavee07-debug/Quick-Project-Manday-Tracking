import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { RESOURCE_POSITIONS, type Resource, type ResourceUpsert } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { PositionBadge } from '../components/PositionBadge';
import './ResourcePage.scss';

const empty: ResourceUpsert = { code: '', name: '', position: '', isActive: true };

export default function ResourcePage() {
  const { isManager } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Resource | null>(null);
  const [form, setForm] = useState<ResourceUpsert>(empty);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // includeInactive so the master page shows everything
      setResources(await api.get<Resource[]>('/resources?includeInactive=true'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(r: Resource) {
    setEditing(r);
    setForm({ code: r.code, name: r.name, position: r.position ?? '', isActive: r.isActive });
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      if (editing) await api.put(`/resources/${editing.resourceId}`, form);
      else await api.post('/resources', form);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(r: Resource) {
    if (!confirm(`ลบ resource "${r.name}"?`)) return;
    try {
      await api.del(`/resources/${r.resourceId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div className="resources">
      <div className="resources__head">
        <h1>Master Resource</h1>
        {isManager && (
          <button className="btn btn--primary" onClick={openCreate}>+ เพิ่ม Resource</button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>ชื่อ</th>
              <th>Position</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="muted">กำลังโหลด…</td></tr>
            ) : resources.length === 0 ? (
              <tr><td colSpan={5} className="muted">ยังไม่มี resource</td></tr>
            ) : (
              resources.map((r) => (
                <tr key={r.resourceId}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td><PositionBadge position={r.position} /></td>
                  <td>
                    <span className={`badge ${r.isActive ? 'badge--actual' : 'badge--adjust'}`}>
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="num">
                    {isManager && (
                      <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn--sm" onClick={() => openEdit(r)}>แก้ไข</button>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(r)}>ลบ</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editing ? 'แก้ไข Resource' : 'เพิ่ม Resource'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">Code</label>
            <input className="input" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })} required />

            <label className="field-label">ชื่อ</label>
            <input className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required />

            <label className="field-label">Position</label>
            <select className="input" value={form.position ?? ''}
              onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <option value="">— ไม่ระบุ —</option>
              {RESOURCE_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>

            <label className="resources__check">
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              ใช้งาน (Active)
            </label>

            {formError && <p className="error-text">{formError}</p>}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>ยกเลิก</button>
              <button type="submit" className="btn btn--primary">บันทึก</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
