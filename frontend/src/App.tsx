import { Navigate, Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import ProjectListPage from './pages/ProjectListPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import MandaySummaryPage from './pages/MandaySummaryPage';
import ResourceMandaySummaryPage from './pages/ResourceMandaySummaryPage';
import ResourcePage from './pages/ResourcePage';
import UsersPage from './pages/UsersPage';
import ConfigPage from './pages/ConfigPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session } = useAuth();
  return session ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/projects" element={<ProjectListPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/manday-summary" element={<MandaySummaryPage />} />
        <Route path="/resource-manday-summary" element={<ResourceMandaySummaryPage />} />
        <Route path="/resources" element={<ResourcePage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/" element={<Navigate to="/projects" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
