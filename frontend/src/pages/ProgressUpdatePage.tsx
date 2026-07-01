import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ImportExportBar } from '../components/ImportExportBar';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import './ProjectListPage.scss';

/**
 * Bulk progress/status update via Excel (columns: Project No, Name, Progress, Status).
 * Export the current sheet, edit Progress/Status, re-import to apply.
 */
export default function ProgressUpdatePage() {
  const { isManager } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.get<Project[]>('/projects'));
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

  return (
    <div className="projects">
      <div className="projects__head">
        <h1>อัพเดท Progress</h1>
      </div>

      <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
        Export ไฟล์ Excel (คอลัมน์: Project No, Name, Progress, Status) แก้ไขค่า Progress/Status แล้ว Import
        กลับเพื่ออัปเดตทีเดียวหลายโปรเจกต์
      </p>

      <div className="projects__toolbar">
        <ImportExportBar
          exportPath="/export/progress"
          exportFilename="progress.xlsx"
          importPath="/import/progress"
          canImport={isManager}
          onImported={load}
        />
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th className="nowrap">Project No</th>
              <th>Name</th>
              <th style={{ minWidth: 180 }}>Progress</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="muted">กำลังโหลด…</td></tr>
            ) : projects.length === 0 ? (
              <tr><td colSpan={4} className="muted">ยังไม่มีโปรเจกต์</td></tr>
            ) : (
              projects.map((p) => (
                <tr key={p.projectId}>
                  <td className="nowrap">{p.code}</td>
                  <td>{p.name}</td>
                  <td><ProgressBar value={p.progress} /></td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
