import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { EntryType, MandayEntry, MandayUpsert, Resource, TaskItem, TaskSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Modal } from './Modal';
import { ImportExportBar } from './ImportExportBar';
import { PositionBadge } from './PositionBadge';
import { TaskStatusBadge } from './TaskStatusBadge';
import './EstimateActualTab.scss';

const ALL_TYPES: EntryType[] = ['Budget', 'Actual', 'Adjust'];

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

interface FormState extends MandayUpsert {
  taskId: number;
}

export function EstimateActualTab({ projectId, projectCode, projectRevenue }:
  { projectId: number; projectCode: string; projectRevenue?: number | null }) {
  const { isManager, hasRole } = useAuth();
  const canRecordActual = isManager || hasRole('Member');

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [summary, setSummary] = useState<TaskSummary[]>([]);
  const [entriesByTask, setEntriesByTask] = useState<Record<number, MandayEntry[]>>({});
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Types this user may create/edit.
  const allowedTypes = useMemo<EntryType[]>(
    () => (isManager ? ALL_TYPES : ['Actual']),
    [isManager],
  );

  const load = useCallback(async () => {
    try {
      const [t, r, s] = await Promise.all([
        api.get<TaskItem[]>(`/projects/${projectId}/tasks`),
        api.get<Resource[]>('/resources'),
        api.get<TaskSummary[]>(`/projects/${projectId}/summary`),
      ]);
      setTasks(t);
      setResources(r);
      setSummary(s);

      const lists = await Promise.all(t.map((task) => api.get<MandayEntry[]>(`/tasks/${task.taskId}/mandays`)));
      const map: Record<number, MandayEntry[]> = {};
      t.forEach((task, i) => (map[task.taskId] = lists[i]));
      setEntriesByTask(map);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const summaryByTask = useMemo(() => {
    const m: Record<number, TaskSummary> = {};
    summary.forEach((s) => (m[s.taskId] = s));
    return m;
  }, [summary]);

  const projectTotals = useMemo(() => {
    return summary.reduce(
      (acc, s) => ({
        budget: acc.budget + s.totalBudget,
        adjust: acc.adjust + s.totalAdjust,
        actual: acc.actual + s.totalActual,
        remaining: acc.remaining + s.remaining,
      }),
      { budget: 0, adjust: 0, actual: 0, remaining: 0 },
    );
  }, [summary]);

  function openAdd(taskId: number) {
    setEditingId(null);
    setForm({ taskId, entryType: allowedTypes[0], resourceId: null, manday: 0, entryDate: null, startDate: null, endDate: null, note: '' });
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(e: MandayEntry) {
    setEditingId(e.mandayEntryId);
    setForm({
      taskId: e.taskId,
      entryType: e.entryType,
      resourceId: e.resourceId ?? null,
      manday: e.manday,
      entryDate: e.entryDate ?? null,
      startDate: e.startDate ?? null,
      endDate: e.endDate ?? null,
      note: e.note ?? '',
    });
    setFormError(null);
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setFormError('End Date ต้องไม่ก่อน Start Date');
      return;
    }
    const payload: MandayUpsert = {
      entryType: form.entryType,
      resourceId: form.resourceId ? Number(form.resourceId) : null,
      manday: form.manday,
      entryDate: form.entryDate || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      note: form.note || null,
    };
    try {
      if (editingId) await api.put(`/mandays/${editingId}`, payload);
      else await api.post(`/tasks/${form.taskId}/mandays`, payload);
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    }
  }

  async function remove(entry: MandayEntry) {
    if (!confirm('ลบรายการ manday นี้?')) return;
    try {
      await api.del(`/mandays/${entry.mandayEntryId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  // A user may edit a row if they're a manager, or a Member editing an Actual row.
  const canEditRow = (t: EntryType) => isManager || (hasRole('Member') && t === 'Actual');

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="ea">
      <ImportExportBar
        exportPath={`/export/mandays?projectId=${projectId}`}
        exportFilename={`estimate-actual-project-${projectId}.xlsx`}
        importPath="/import/mandays"
        canImport={isManager}
        onImported={load}
      />

      <div className="kpi-grid ea__kpi">
        <div className="statcard statcard--teal">
          <div className="statcard__label">Revenue (Project)</div>
          <div className="statcard__value">{projectRevenue != null ? money(projectRevenue) : '—'}</div>
        </div>
        <div className="statcard statcard--blue">
          <div className="statcard__label">Sum Budget</div>
          <div className="statcard__value">{fmt(projectTotals.budget)}</div>
        </div>
        <div className="statcard statcard--amber">
          <div className="statcard__label">Sum Adjust</div>
          <div className="statcard__value">{fmt(projectTotals.adjust)}</div>
        </div>
        <div className="statcard statcard--green">
          <div className="statcard__label">Sum Actual</div>
          <div className="statcard__value">{fmt(projectTotals.actual)}</div>
        </div>
        <div className={`statcard ${projectTotals.remaining < 0 ? 'statcard--red' : 'statcard--navy'}`}>
          <div className="statcard__label">คงเหลือ = (Budget+Adjust)−Actual</div>
          <div className={`statcard__value ${projectTotals.remaining < 0 ? 'over-budget' : ''}`}>
            {fmt(projectTotals.remaining)}
          </div>
        </div>
      </div>

      {tasks.length === 0 && <p className="muted">ยังไม่มี task — เพิ่ม task ในแท็บ Task ก่อน</p>}

      {tasks.map((task) => {
        const s = summaryByTask[task.taskId];
        const rows = entriesByTask[task.taskId] ?? [];
        return (
          <div className="ea__task card" key={task.taskId}>
            <div className="ea__task-head">
              <div>
                <h3 className="ea__task-name">
                  {task.name}
                  <span style={{ marginLeft: 'var(--space-2)' }}><TaskStatusBadge status={task.status} /></span>
                  {task.revenue != null && (
                    <span className="ea__task-revenue">Revenue {money(task.revenue)}</span>
                  )}
                </h3>
                {task.description && <p className="muted ea__task-desc">{task.description}</p>}
                {s && (
                  <span className="muted ea__task-sub">
                    Budget {fmt(s.totalBudget)} · Adjust {fmt(s.totalAdjust)} · Actual {fmt(s.totalActual)} · คงเหลือ{' '}
                    <span className={s.remaining < 0 ? 'over-budget' : ''}>{fmt(s.remaining)}</span>
                  </span>
                )}
              </div>
              {canRecordActual && (
                task.status === 'Done'
                  ? <span className="muted">Task เสร็จแล้ว — เพิ่มรายการไม่ได้</span>
                  : <button className="btn btn--sm btn--primary" onClick={() => openAdd(task.taskId)}>
                      + เพิ่ม Manday
                    </button>
              )}
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Task</th>
                  <th>Type</th>
                  <th>Resource</th>
                  <th>Position</th>
                  <th className="num">Manday</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} className="muted">ยังไม่มีรายการ</td></tr>
                ) : (
                  rows.map((e) => (
                    <tr key={e.mandayEntryId}>
                      <td>{projectCode}</td>
                      <td>{task.name}</td>
                      <td><span className={`badge badge--${e.entryType.toLowerCase()}`}>{e.entryType}</span></td>
                      <td>{e.resourceName ?? '—'}</td>
                      <td><PositionBadge position={e.resourcePosition} /></td>
                      <td className="num">{fmt(e.manday)}</td>
                      <td className="muted">{e.startDate ?? '—'}</td>
                      <td className="muted">{e.endDate ?? '—'}</td>
                      <td className="muted">{e.note ?? ''}</td>
                      <td className="num">
                        {canEditRow(e.entryType) && (
                          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                            <button className="btn btn--sm" onClick={() => openEdit(e)}>แก้ไข</button>
                            <button className="btn btn--sm btn--danger" onClick={() => remove(e)}>ลบ</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      {showForm && form && (
        <Modal title={editingId ? 'แก้ไข Manday' : 'เพิ่ม Manday'} onClose={() => setShowForm(false)}>
          <form onSubmit={submit}>
            <label className="field-label">ประเภท (Type)</label>
            <select className="input" value={form.entryType}
              onChange={(ev) => setForm({ ...form, entryType: ev.target.value as EntryType })}>
              {allowedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="field-label">Resource</label>
            <select className="input" value={form.resourceId ?? ''}
              onChange={(ev) => setForm({ ...form, resourceId: ev.target.value ? Number(ev.target.value) : null })}>
              <option value="">— ไม่ระบุ —</option>
              {resources.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.name}</option>)}
            </select>

            <label className="field-label">Manday</label>
            <input className="input" type="number" step="0.5" min="0" value={form.manday}
              onChange={(ev) => setForm({ ...form, manday: Number(ev.target.value) })} required />

            <label className="field-label">Start Date</label>
            <input className="input" type="date" value={form.startDate ?? ''}
              onChange={(ev) => {
                const start = ev.target.value || null;
                // Auto-fill End = Start when End is still empty; keep a manually-set End.
                setForm({ ...form, startDate: start, endDate: form.endDate || start });
              }} />

            <label className="field-label">End Date</label>
            <input className="input" type="date" value={form.endDate ?? ''} min={form.startDate ?? undefined}
              onChange={(ev) => setForm({ ...form, endDate: ev.target.value || null })} />

            <label className="field-label">หมายเหตุ</label>
            <input className="input" value={form.note ?? ''}
              onChange={(ev) => setForm({ ...form, note: ev.target.value })} />

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
