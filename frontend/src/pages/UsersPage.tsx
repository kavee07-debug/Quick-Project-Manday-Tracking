import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { ROLES, type User, type UserUpsert } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { RoleBadge } from '../components/RoleBadge';
import './ResourcePage.scss';

const empty: UserUpsert = { email: '', displayName: '', isActive: true, roles: ['User'] };

export default function UsersPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserUpsert>(empty);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setUsers(await api.get<User[]>('/users'));
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

  function openEdit(u: User) {
    setEditing(u);
    setForm({ email: u.email, displayName: u.displayName, isActive: u.isActive, roles: [...u.roles] });
    setFormError(null);
    setShowForm(true);
  }

  function toggleRole(role: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      roles: checked ? [...new Set([...f.roles, role])] : f.roles.filter((r) => r !== role),
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (form.roles.length === 0) {
      setFormError('ต้องเลือกอย่างน้อย 1 role');
      return;
    }
    try {
      if (editing) await api.put(`/users/${editing.userId}`, form);
      else await api.post('/users', form);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function deactivate(u: User) {
    if (!confirm(`ปิดใช้งานผู้ใช้ "${u.email}"? (ผู้ใช้จะล็อกอินไม่ได้)`)) return;
    try {
      await api.del(`/users/${u.userId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ทำรายการไม่สำเร็จ');
    }
  }

  if (!isAdmin) return <p className="error-text">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</p>;

  return (
    <div className="resources">
      <div className="resources__head">
        <h1>จัดการผู้ใช้</h1>
        <button className="btn btn--primary" onClick={openCreate}>+ เพิ่มผู้ใช้</button>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>อีเมล</th>
              <th>ชื่อ</th>
              <th>Role</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="muted">กำลังโหลด…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="muted">ยังไม่มีผู้ใช้</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.email}</td>
                  <td>{u.displayName}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      {u.roles.map((r) => <RoleBadge key={r} role={r} />)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.isActive ? 'badge--actual' : 'badge--adjust'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="num">
                    <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                      <button className="btn btn--sm" onClick={() => openEdit(u)}>แก้ไข</button>
                      {u.isActive && (
                        <button className="btn btn--sm btn--danger" onClick={() => deactivate(u)}>ปิดใช้งาน</button>
                      )}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title={editing ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">อีเมล (Microsoft account)</label>
            <input className="input" type="email" value={form.email} disabled={!!editing}
              onChange={(e) => setForm({ ...form, email: e.target.value })} required />

            <label className="field-label">ชื่อ</label>
            <input className="input" value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />

            <label className="field-label">Role</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {ROLES.map((r) => (
                <label key={r} className="resources__check">
                  <input type="checkbox" checked={form.roles.includes(r)}
                    onChange={(e) => toggleRole(r, e.target.checked)} />
                  {r}
                </label>
              ))}
            </div>

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
