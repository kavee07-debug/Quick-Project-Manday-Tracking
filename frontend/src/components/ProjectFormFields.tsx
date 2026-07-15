import { useMemo, useState } from 'react';
import { PROJECT_STATUSES, PROJECT_TYPES, type Customer, type ProjectUpsert } from '../api/types';

// Shared project create/edit form fields (used by the Projects list modal and the Project tab).
// Wrap in a <form onSubmit> and add the error text + submit/cancel actions around it.
export function ProjectFormFields({
  form,
  setForm,
  customers,
}: {
  form: ProjectUpsert;
  setForm: (f: ProjectUpsert) => void;
  customers: Customer[];
}) {
  const [custQuery, setCustQuery] = useState('');   // search text for the customer combobox
  const [custOpen, setCustOpen] = useState(false);   // whether the combobox list is open

  // Label of the currently selected customer (empty = ไม่ระบุ).
  const selectedCustomer = customers.find((c) => c.customerId === form.customerId);
  const custLabel = selectedCustomer ? `${selectedCustomer.code} · ${selectedCustomer.name}` : '';

  // Customers filtered by the combobox search (matches code or name); capped for perf.
  const custMatches = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    const list = q ? customers.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(q)) : customers;
    return list.slice(0, 50);
  }, [customers, custQuery]);

  // Pick a customer from the searchable combobox (null = clear).
  function selectCustomer(id: number | null) {
    setForm({ ...form, customerId: id });
    setCustOpen(false); setCustQuery('');
  }

  return (
    <>
      <label className="field-label">รหัสโปรเจกต์</label>
      <input className="input" value={form.code}
        onChange={(e) => setForm({ ...form, code: e.target.value })} required />

      <label className="field-label">ชื่อ</label>
      <input className="input" value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })} required />

      <label className="field-label">รายละเอียด</label>
      <input className="input" value={form.description ?? ''}
        onChange={(e) => setForm({ ...form, description: e.target.value })} />

      <label className="field-label">ลูกค้า (Customer)</label>
      <div className="combo">
        <input className="input" placeholder="ค้นหาลูกค้า (รหัส หรือ ชื่อ)…"
          value={custOpen ? custQuery : custLabel}
          onFocus={() => { setCustOpen(true); setCustQuery(''); }}
          onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); }}
          onBlur={() => setTimeout(() => setCustOpen(false), 150)} />
        {custOpen && (
          <ul className="combo__list">
            <li className="muted" onMouseDown={() => selectCustomer(null)}>— ไม่ระบุ —</li>
            {custMatches.map((c) => (
              <li key={c.customerId} onMouseDown={() => selectCustomer(c.customerId)}>
                <b>{c.code}</b> · {c.name}
              </li>
            ))}
            {custMatches.length === 0 && <li className="muted">ไม่พบลูกค้าที่ค้นหา</li>}
          </ul>
        )}
      </div>

      <label className="field-label">ประเภท (Type)</label>
      <select className="input" value={form.type ?? ''}
        onChange={(e) => setForm({ ...form, type: e.target.value })}>
        {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      <label className="field-label">Training Date</label>
      <input className="input" value={form.trainingDate ?? ''}
        placeholder="เช่น 15-17 ก.ค. 2026"
        onChange={(e) => setForm({ ...form, trainingDate: e.target.value === '' ? null : e.target.value })} />
      {form.type === 'Training' && (
        <p className="muted" style={{ marginTop: 'var(--space-1)' }}>
          ประเภท = Training — ข้อความนี้จะแสดงต่อท้ายชื่อโปรเจกต์ (สีม่วง)
        </p>
      )}

      <label className="field-label">สถานะ (Status)</label>
      <select className="input" value={form.status}
        onChange={(e) => setForm({ ...form, status: e.target.value })}>
        {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <label className="field-label">Progress (%)</label>
      <input className="input" type="number" step="0.01" min="0" max="100" value={form.progress ?? ''}
        onChange={(e) => setForm({ ...form, progress: e.target.value === '' ? null : Number(e.target.value) })} />

      <label className="field-label">มูลค่าโครงการ (Revenue)</label>
      <input className="input" type="number" step="0.01" min="0" value={form.revenue ?? ''}
        onChange={(e) => setForm({ ...form, revenue: e.target.value === '' ? null : Number(e.target.value) })} />

      <label className="field-label">Timesheet Mapping</label>
      <input className="input" value={form.timesheetMapping ?? ''}
        placeholder={form.code ? `ค่าเริ่มต้น = ${form.code}` : 'ค่าเริ่มต้น = รหัสโปรเจกต์'}
        onChange={(e) => setForm({ ...form, timesheetMapping: e.target.value === '' ? null : e.target.value })} />
      <p className="muted" style={{ marginTop: 'var(--space-1)' }}>
        ใช้จับคู่ Timesheet (Job No,Task No) เช่น <b>{form.code || 'SOJ2510-0033'}</b> หรือ{' '}
        <b>{form.code || 'SOJ2510-0033'},T10</b> — เว้นว่างจะใช้รหัสโปรเจกต์เป็นค่าเริ่มต้น
      </p>
    </>
  );
}
