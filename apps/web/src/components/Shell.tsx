import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

const NAV = [
  { to: '/research', label: 'Research' },
  { to: '/workspace', label: 'Workspace' },
  { to: '/collab', label: 'Collab' },
  { to: '/surfaces', label: 'Surfaces' },
  { to: '/agent', label: 'Agent & Cowork' },
  { to: '/automation', label: 'Automation' },
  { to: '/billing', label: 'Billing' },
  { to: '/settings', label: 'Settings' },
];

export function Shell() {
  const { user, logout } = useAuth();
  // The Admin console only appears for allowlisted operators (server-enforced; this just hides the link).
  const nav = user?.isAdmin ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV;
  const [health, setHealth] = useState<string | null>(null);
  useEffect(() => {
    void api.health().then((h) => setHealth(`${h.mode === 'real' ? 'live models' : 'demo mode'} · ${h.persistence}`)).catch(() => {});
  }, []);
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">Apolla AI</div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <strong>Workbench</strong>
          <div className="row">
            {health && <span className="badge">{health}</span>}
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
