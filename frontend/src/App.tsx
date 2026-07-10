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
import CustomersPage from './pages/CustomersPage';
import MasterItemsPage from './pages/MasterItemsPage';
import ProgressUpdatePage from './pages/ProgressUpdatePage';
import D365SetupPage from './pages/D365SetupPage';
import D365JobPage from './pages/D365JobPage';
import D365TimesheetPage from './pages/D365TimesheetPage';
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
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/master-items" element={<MasterItemsPage />} />
        <Route path="/progress-update" element={<ProgressUpdatePage />} />
        <Route path="/d365/setup" element={<D365SetupPage />} />
        <Route path="/d365/jobs" element={<D365JobPage />} />
        <Route path="/d365/timesheet" element={<D365TimesheetPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/" element={<Navigate to="/projects" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
