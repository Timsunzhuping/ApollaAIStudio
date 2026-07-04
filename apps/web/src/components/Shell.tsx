import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

// Icon paths (Lucide-style, 24x24 viewBox) keyed by nav route.
const ICONS: Record<string, string> = {
  '/research': 'M11 3a8 8 0 1 0 4.9 14.3l4.4 4.4M11 3a8 8 0 0 1 8 8',
  '/workspace': 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  '/collab': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 .01M23 21v-2a4 4 0 0 0-3-3.87',
  '/surfaces': 'M4 5h16v4H4zM4 13h7v6H4zM15 13h5v6h-5z',
  '/agent': 'M12 8V4H8M4 8h16v12H4zM2 14h2M20 14h2M9 13v2M15 13v2',
  '/automation': 'M12 3a9 9 0 1 0 9 9M12 7v5l3 3M12 3v2',
  '/billing': 'M3 10h18M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  '/settings': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z',
  '/admin': 'M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z',
};

const PRIMARY = [
  { to: '/research', label: 'Research' },
  { to: '/workspace', label: 'Workspace' },
  { to: '/collab', label: 'Collab' },
  { to: '/surfaces', label: 'Surfaces' },
  { to: '/agent', label: 'Agent & Cowork' },
  { to: '/automation', label: 'Automation' },
];

function NavIcon({ to }: { to: string }) {
  const d = ICONS[to];
  if (!d) return null;
  return (
    <svg className="nav-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
      <NavIcon to={to} />
      {label}
    </NavLink>
  );
}

export function Shell() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void api.health().then((h) => setHealth(`${h.mode === 'real' ? 'live models' : 'demo mode'} · ${h.persistence}`)).catch(() => {});
    void api.version().then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">Apolla AI</div>
        {PRIMARY.map((n) => <NavItem key={n.to} to={n.to} label={n.label} />)}

        {/* Account group: settings/billing/admin de-emphasized below the core tasks (QW3). */}
        <div style={{ marginTop: 'auto' }}>
          <div className="nav-group-label">Account</div>
          <NavItem to="/billing" label="Billing" />
          <NavItem to="/settings" label="Settings" />
          {user?.isAdmin && <NavItem to="/admin" label="Admin" />}
          {(health || version) && (
            <div className="meta faint" style={{ padding: '0.55rem 0.6rem 0', fontSize: '0.72rem' }} data-testid="app-version">
              {health}{health && version ? ' · ' : ''}{version ? `v${version}` : ''}
            </div>
          )}
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <span className="title">Workbench</span>
          <div className="row">
            <span className="muted" style={{ fontSize: '0.85rem' }}>{user?.email}</span>
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
