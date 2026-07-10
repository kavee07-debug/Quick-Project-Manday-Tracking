import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { TaskItem, TaskUpsert } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from './Modal';
import { ImportExportBar } from './ImportExportBar';

const empty: TaskUpsert = { name: '', description: '', status: 'Open', sortOrder: 0 };

export function TaskTab({ projectId }: { projectId: number }) {
  const { isManager } = useAuth();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskUpsert>(empty);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks(await api.get<TaskItem[]>(`/projects/${projectId}/tasks`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลด task ไม่สำเร็จ');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(t: TaskItem) {
    setEditing(t);
    setForm({ name: t.name, description: t.description ?? '', status: t.status, sortOrder: t.sortOrder });
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      if (editing) await api.put(`/tasks/${editing.taskId}`, form);
      else await api.post(`/projects/${projectId}/tasks`, form);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(t: TaskItem) {
    if (!confirm(`ลบ task "${t.name}"? (manday ภายใต้ task จะถูกลบด้วย)`)) return;
    try {
      await api.del(`/tasks/${t.taskId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div>
      <div className="section-head">
        <h2>Task</h2>
        {isManager && <button className="btn btn--primary" onClick={openCreate}>+ เพิ่ม Task</button>}
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <ImportExportBar
          exportPath={`/export/tasks?projectId=${projectId}`}
          exportFilename={`tasks-project-${projectId}.xlsx`}
          importPath="/import/tasks"
          canImport={isManager}
          onImported={load}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ลำดับ</th>
              <th>ชื่อ Task</th>
              <th>รายละเอียด</th>
              <th>Item Category</th>
              <th className="num">Revenue</th>
              <th>สถานะ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={7} className="muted">ยังไม่มี task</td></tr>
            ) : (
              tasks.map((t) => (
                <tr key={t.taskId}>
                  <td>{t.sortOrder}</td>
                  <td>{t.name}</td>
                  <td className="muted">{t.description || '—'}</td>
                  <td>{t.itemCategoryCode ?? '—'}</td>
                  <td className="num">{t.revenue != null ? t.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  <td>{t.status}</td>
                  <td className="num">
                    {isManager && (
                      <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                        <button className="btn btn--sm" onClick={() => openEdit(t)}>แก้ไข</button>
                        <button className="btn btn--sm btn--danger" onClick={() => remove(t)}>ลบ</button>
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
        <Modal title={editing ? 'แก้ไข Task' : 'เพิ่ม Task'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">ชื่อ Task</label>
            <input className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} required />

            <label className="field-label">รายละเอียด</label>
            <input className="input" value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />

            <label className="field-label">สถานะ</label>
            <select className="input" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="Open">Open</option>
              <option value="InProgress">InProgress</option>
              <option value="Done">Done</option>
            </select>

            <label className="field-label">ลำดับ</label>
            <input className="input" type="number" value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />

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
