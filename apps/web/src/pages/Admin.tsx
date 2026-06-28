import { useEffect, useMemo, useState } from 'react';
import { api, type AdminStats, type AdminUserRow, type AdminAuditRow } from '../lib/api';
import { Card } from '../components/ui';

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat" style={{ minWidth: '7rem' }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 600 }}>{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

export function Admin() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [audit, setAudit] = useState<AdminAuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    void api.adminStats().then(setStats).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
    void api.adminUsers(100).then(setUsers).catch(() => {});
    void api.adminAudit(50).then(setAudit).catch(() => {});
  };
  useEffect(load, []);

  const filtered = useMemo(() => users.filter((u) => u.email.toLowerCase().includes(query.toLowerCase())), [users, query]);

  const setPlan = async (id: string, plan: string) => {
    setNote(null);
    try { await api.adminSetPlan(id, plan); setNote(`Updated plan → ${plan}`); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
  };

  if (error) return <div className="col"><Card title="Operator console"><span className="muted">{error}</span></Card></div>;

  return (
    <div className="col">
      <Card title="Operations overview">
        {!stats ? <span className="muted">Loading…</span> : (
          <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }} data-testid="admin-stats">
            <Stat label="Users" value={stats.users} />
            <Stat label="Projects" value={stats.projects} />
            <Stat label="Tasks" value={stats.tasks} />
            <Stat label="Jobs running" value={stats.jobs.running ?? 0} />
            <Stat label="Jobs failed" value={stats.jobs.failed ?? 0} />
            <Stat label="Pro subs" value={stats.subscriptions.pro ?? 0} />
          </div>
        )}
      </Card>

      <Card title="Users">
        <input placeholder="search by email" value={query} onChange={(e) => setQuery(e.target.value)} />
        {note && <span className="muted" data-testid="admin-note">{note}</span>}
        <table className="table" data-testid="admin-users">
          <thead><tr><th>Email</th><th>Plan</th><th>Projects</th><th>Set plan</th></tr></thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.plan ?? 'free'}</td>
                <td>{u.projects}</td>
                <td>
                  <select defaultValue={u.plan ?? 'free'} onChange={(e) => void setPlan(u.id, e.target.value)} aria-label={`plan for ${u.email}`}>
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="team">team</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Recent activity">
        <table className="table" data-testid="admin-audit">
          <thead><tr><th>Tool</th><th>Risk</th><th>Decision</th><th>Summary</th></tr></thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}><td>{a.tool}</td><td>{a.risk}</td><td>{a.decision}</td><td className="muted">{a.summary}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
