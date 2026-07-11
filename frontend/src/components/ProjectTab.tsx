import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Customer, Project, ProjectUpsert } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from './Modal';
import { ProgressBar } from './ProgressBar';
import { StatusBadge } from './StatusBadge';
import { ProjectFormFields } from './ProjectFormFields';

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function toForm(p: Project): ProjectUpsert {
  return {
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    customerId: p.customerId ?? null,
    type: p.type ?? '',
    status: p.status,
    progress: p.progress ?? null,
    revenue: p.revenue ?? null,
    timesheetMapping: p.timesheetMapping ?? null,
    startDate: p.startDate ?? null,
    endDate: p.endDate ?? null,
  };
}

// Project tab: view the project's own fields and (for managers) edit or delete it.
export function ProjectTab({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProjectUpsert>(toForm(project));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Customer[]>('/customers').then(setCustomers).catch(() => setCustomers([]));
  }, []);

  function openEdit() {
    setForm(toForm(project));
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const updated = await api.put<Project>(`/projects/${project.projectId}`, form);
      setShowForm(false);
      onChanged(updated);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove() {
    if (!confirm(`ลบโปรเจกต์ ${project.code}? (ข้อมูล task และ manday จะถูกลบด้วย)`)) return;
    try {
      await api.del(`/projects/${project.projectId}`);
      navigate('/projects');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  const rows: [string, React.ReactNode][] = [
    ['รหัสโปรเจกต์', project.code],
    ['ชื่อ', project.name],
    ['รายละเอียด', project.description || '—'],
    ['ลูกค้า', project.customerName ? `${project.customerCode} · ${project.customerName}` : '—'],
    ['ประเภท', project.type ?? '—'],
    ['สถานะ', <StatusBadge status={project.status} />],
    ['Progress', <ProgressBar value={project.progress} />],
    ['Revenue', project.revenue != null ? money(project.revenue) : '—'],
    ['Timesheet Mapping', project.timesheetMapping || '—'],
    ['วันเริ่ม (Start)', project.startDate ?? '—'],
    ['วันสิ้นสุด (End)', project.endDate ?? '—'],
  ];

  return (
    <div>
      <div className="section-head">
        <h2>Project</h2>
        {isManager && (
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <button className="btn btn--primary" onClick={openEdit}>แก้ไข</button>
            <button className="btn btn--danger" onClick={remove}>ลบโปรเจกต์</button>
          </span>
        )}
      </div>

      <div className="card">
        <table className="table">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th style={{ width: 220, textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 'var(--font-weight-medium)' }}>
                  {label}
                </th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <Modal title="แก้ไขโปรเจกต์" onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <ProjectFormFields form={form} setForm={setForm} customers={customers} />

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
