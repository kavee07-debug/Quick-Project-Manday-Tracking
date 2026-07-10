import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { BoxIcon, ChartIcon, ClockIcon, GearIcon, GridIcon, LogoutIcon, MenuIcon, PeopleIcon, PlugIcon, UserIcon } from './icons';
import './AppLayout.scss';

const SIDEBAR_KEY = 'qtm.sidebar';

export function AppLayout() {
  const { session, logout, hasRole } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'collapsed');

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  const navItem = ({ isActive }: { isActive: boolean }) =>
    `sidebar__item ${isActive ? 'sidebar__item--active' : ''}`;

  return (
    <div className="layout">
      <header className="topbar">
        <button
          className="topbar__burger"
          aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
          onClick={toggleSidebar}
        >
          <MenuIcon size={22} />
        </button>

        <Link to="/projects" className="topbar__brand">
          <img src="/logo.png" className="topbar__logo" alt="Quick Transformation" />
          <span className="topbar__divider" />
          <span className="topbar__product">
            <span className="topbar__product-name">Quick Project Manday Tracking</span>
            <span className="topbar__product-sub">ระบบติดตาม Manday โครงการ</span>
          </span>
        </Link>

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          <span className="topbar__user">
            <UserIcon size={18} />
            <span>
              {session?.displayName}
              <span className="muted"> · {session?.roles.join(', ')}</span>
            </span>
          </span>
          <button className="btn btn--navy" onClick={logout}>
            <LogoutIcon size={18} /> ออกจากระบบ
          </button>
        </div>
      </header>

      <div className="layout__body">
        <nav className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
          <NavLink to="/projects" className={navItem} title="Projects">
            <GridIcon size={20} /> <span className="sidebar__label">Projects</span>
          </NavLink>
          <NavLink to="/manday-summary" className={navItem} title="Manday Summary">
            <ChartIcon size={20} /> <span className="sidebar__label">Manday Summary</span>
          </NavLink>
          <NavLink to="/resource-manday-summary" className={navItem} title="Resource Manday Summary">
            <ChartIcon size={20} /> <span className="sidebar__label">Resource Manday Summary</span>
          </NavLink>
          {hasRole('Admin', 'ProjectManager') && (
            <NavLink to="/progress-update" className={navItem} title="อัพเดท Progress">
              <ChartIcon size={20} /> <span className="sidebar__label">อัพเดท Progress</span>
            </NavLink>
          )}
          {hasRole('Admin', 'ProjectManager') && (
            <NavLink to="/customers" className={navItem} title="Master Customer">
              <PeopleIcon size={20} /> <span className="sidebar__label">Master Customer</span>
            </NavLink>
          )}
          {hasRole('Admin', 'ProjectManager') && (
            <NavLink to="/resources" className={navItem} title="Master Resource">
              <PeopleIcon size={20} /> <span className="sidebar__label">Master Resource</span>
            </NavLink>
          )}
          {hasRole('Admin', 'ProjectManager') && (
            <NavLink to="/master-items" className={navItem} title="Master Item">
              <BoxIcon size={20} /> <span className="sidebar__label">Master Item</span>
            </NavLink>
          )}
          {hasRole('Admin') && (
            <NavLink to="/users" className={navItem} title="จัดการผู้ใช้">
              <UserIcon size={20} /> <span className="sidebar__label">จัดการผู้ใช้</span>
            </NavLink>
          )}
          {hasRole('Admin') && (
            <NavLink to="/config" className={navItem} title="ตั้งค่า DB">
              <GearIcon size={20} /> <span className="sidebar__label">ตั้งค่า DB</span>
            </NavLink>
          )}
          {hasRole('Admin') && (
            <>
              <div className="sidebar__section" title="API">
                <span className="sidebar__label">API</span>
              </div>
              <NavLink to="/d365/setup" className={navItem} title="ตั้งค่า API (BC)">
                <PlugIcon size={20} /> <span className="sidebar__label">ตั้งค่า API (BC)</span>
              </NavLink>
              <NavLink to="/d365/jobs" className={navItem} title="API Job">
                <PlugIcon size={20} /> <span className="sidebar__label">API Job</span>
              </NavLink>
              <NavLink to="/d365/timesheet" className={navItem} title="Timesheet">
                <ClockIcon size={20} /> <span className="sidebar__label">Timesheet</span>
              </NavLink>
            </>
          )}
        </nav>

        <main className="layout__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
