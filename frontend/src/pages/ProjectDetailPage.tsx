import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { RefreshButton } from '../components/RefreshButton';
import { Tabs } from '../components/Tabs';
import { TaskTab } from '../components/TaskTab';
import { EstimateActualTab } from '../components/EstimateActualTab';
import { ProjectTab } from '../components/ProjectTab';
import './ProjectDetailPage.scss';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('tasks');
  // Bumped by Refresh; the tabs watch it and re-fetch their own rows without remounting.
  const [reloadKey, setReloadKey] = useState(0);

  const loadProject = useCallback(async () => {
    try {
      setProject(await api.get<Project>(`/projects/${projectId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, [projectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  async function refresh() {
    await loadProject();
    setReloadKey((k) => k + 1);
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!project) return <p className="muted">กำลังโหลด…</p>;

  return (
    <div className="detail">
      <div className="detail__breadcrumb muted">
        <Link to="/projects">Project</Link> / {project.code}
      </div>
      <div className="section-head">
        <h1 className="detail__title">
          {project.code} — {project.name}
          {project.type === 'Training' && project.trainingDate && (
            <span className="detail__training"> {project.trainingDate}</span>
          )}
        </h1>
        <RefreshButton onRefresh={refresh} />
      </div>

      <Tabs
        tabs={[
          { key: 'tasks', label: 'Task' },
          { key: 'manday', label: 'Estimate & Actual' },
          { key: 'project', label: 'Project' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'tasks' ? (
        <TaskTab projectId={projectId} reloadKey={reloadKey} />
      ) : tab === 'manday' ? (
        <EstimateActualTab projectId={projectId} projectCode={project.code} projectRevenue={project.revenue} projectType={project.type} reloadKey={reloadKey} />
      ) : (
        <ProjectTab project={project} onChanged={setProject} />
      )}
    </div>
  );
}
