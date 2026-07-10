import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Project } from '../api/types';
import { Tabs } from '../components/Tabs';
import { TaskTab } from '../components/TaskTab';
import { EstimateActualTab } from '../components/EstimateActualTab';
import './ProjectDetailPage.scss';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('tasks');

  useEffect(() => {
    api
      .get<Project>(`/projects/${projectId}`)
      .then(setProject)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'));
  }, [projectId]);

  if (error) return <p className="error-text">{error}</p>;
  if (!project) return <p className="muted">กำลังโหลด…</p>;

  return (
    <div className="detail">
      <div className="detail__breadcrumb muted">
        <Link to="/projects">โปรเจกต์</Link> / {project.code}
      </div>
      <h1 className="detail__title">
        {project.code} — {project.name}
      </h1>

      <Tabs
        tabs={[
          { key: 'tasks', label: 'Task' },
          { key: 'manday', label: 'Estimate & Actual' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'tasks' ? (
        <TaskTab projectId={projectId} />
      ) : (
        <EstimateActualTab projectId={projectId} projectCode={project.code} projectRevenue={project.revenue} />
      )}
    </div>
  );
}
