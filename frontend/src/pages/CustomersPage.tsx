import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { Customer, CustomerUpsert } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/Modal';
import { ImportExportBar } from '../components/ImportExportBar';
import './ResourcePage.scss';

const empty: CustomerUpsert = { code: '', name: '', isActive: true };

export default function CustomersPage() {
  const { isManager } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerUpsert>(empty);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setCustomers(await api.get<Customer[]>('/customers?includeInactive=true'));
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

  function openEdit(c: Customer) {
    setEditing(c);
    setForm({ code: c.code, name: c.name, isActive: c.isActive });
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      if (editing) await api.put(`/customers/${editing.customerId}`, form);
      else await api.post('/customers', form);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(c: Customer) {
    if (!confirm(`ลบลูกค้า "${c.name}"?`)) return;
    try {
      await api.del(`/customers/${c.customerId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div className="resources">
      <div className="resources__head">
        <h1>Master Customer</h1>
        {isManager && (
          <button className="btn btn--primary" onClick={openCreate}>+ เพิ่มลูกค้า</button>
        )}
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <ImportExportBar
          exportPath="/export/customers"
          exportFilename="customers.xlsx"
          importPath="/import/customers"
          canImport={isManager}
          onImported={load}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>รหัสลูกค้า</th>
              <th>ชื่อลูกค้า</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="muted">กำลังโหลด…</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={4} className="muted">ยังไม่มีลูกค้า</td></tr>
            ) : (
              customers.map((c) => (
                <tr key={c.customerId}>
                  <td>{c.code}</td>
                  <td>{c.name}</td>
                  <td>
                    <span className={`badge ${c.isActive ? 'badge--actual' : 'badge--adjust'}`}>
                      {c.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="num">
                    {isManager && (
                      <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn--sm" onClick={() => openEdit(c)}>แก้ไข</button>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(c)}>ลบ</button>
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
        <Modal title={editing ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">รหัสลูกค้า</label>
            <input className="input" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })} required />

            <label className="field-label">ชื่อลูกค้า</label>
            <input className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required />

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
