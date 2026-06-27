import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/research', label: 'Research' },
  { to: '/workspace', label: 'Workspace' },
  { to: '/surfaces', label: 'Surfaces' },
  { to: '/agent', label: 'Agent & Cowork' },
  { to: '/automation', label: 'Automation' },
  { to: '/settings', label: 'Settings' },
];

export function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">Apolla AI</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <strong>Workbench</strong>
          <div className="row">
            <span className="muted">{user?.email}</span>
            <button className="ghost" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
