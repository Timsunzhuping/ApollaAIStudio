import { useEffect, useState } from 'react';
import { api, type Connector, type AuditEntry } from '../lib/api';
import type { Plugin, ConnectorCatalogEntry } from '@apolla/contracts';
import { useSSE } from '../lib/sse';
import { Card, Empty } from '../components/ui';

type Ev = { type: string } & Record<string, unknown>;

export function Agent() {
  // connectors + marketplace
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const loadConnectors = () => api.connectors().then(setConnectors).catch(() => {});
  const [catalog, setCatalog] = useState<ConnectorCatalogEntry[]>([]);
  const [catId, setCatId] = useState('');
  const [catUrl, setCatUrl] = useState('');
  const [catToken, setCatToken] = useState('');
  const [catErr, setCatErr] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, string>>({});
  const checkHealth = async (id: string) => {
    const h: { ok: boolean; toolCount?: number; ms?: number } = await api.connectorHealth(id).catch(() => ({ ok: false }));
    setHealth((m) => ({ ...m, [id]: h.ok ? `🟢 ${h.toolCount ?? 0} tools · ${h.ms ?? 0}ms` : '🔴 unreachable' }));
  };
  const installFromCatalog = async () => {
    setCatErr(null);
    try {
      await api.installFromCatalog(catId, catUrl, catToken ? { token: catToken } : {});
      setCatUrl(''); setCatToken('');
      await loadConnectors();
    } catch (e) {
      setCatErr(e instanceof Error ? e.message : 'install failed');
    }
  };
  // plugins
  const [official, setOfficial] = useState<Plugin[]>([]);
  const [installed, setInstalled] = useState<Plugin[]>([]);
  const loadPlugins = async () => {
    setOfficial(await api.officialPlugins().catch(() => []));
    setInstalled(await api.installedPlugins().catch(() => []));
  };
  useEffect(() => {
    void loadConnectors();
    void loadPlugins();
    void api.connectorCatalog().then((c) => { setCatalog(c); setCatId(c[0]?.id ?? ''); }).catch(() => {});
  }, []);

  // agent
  const [goal, setGoal] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentUrl, setAgentUrl] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ tool: string; risk: string } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const runAgent = async () => {
    if (!goal.trim()) return;
    setTrace([]); setConfirm(null); setAudit([]);
    const { agentId: id } = await api.runAgent(goal.trim());
    setAgentId(id);
    setAgentUrl(api.agentEventsUrl(id));
  };
  useSSE<Ev>(agentUrl, (ev) => {
    if (ev.type === 'plan') setTrace((t) => [...t, '📋 planning…']);
    else if (ev.type === 'tool-call') setTrace((t) => [...t, `🔧 ${ev.tool} [${ev.risk}]`]);
    else if (ev.type === 'tool-result') setTrace((t) => [...t, `✓ ${ev.tool}: ${String(ev.summary ?? '').slice(0, 80)}`]);
    else if (ev.type === 'denied') setTrace((t) => [...t, `⛔ ${ev.tool} — ${ev.reason}`]);
    else if (ev.type === 'delta') setTrace((t) => [...t, `💬 ${ev.text}`]);
    else if (ev.type === 'confirm') setConfirm({ tool: String(ev.tool), risk: String(ev.risk) });
    else if (ev.type === 'done') { setAgentUrl(null); if (agentId) void api.audit(agentId).then(setAudit); }
    else if (ev.type === 'error') { setTrace((t) => [...t, `error: ${ev.message}`]); setAgentUrl(null); }
  });
  const respond = async (approved: boolean) => {
    if (!agentId) return;
    await api.confirmAgent(agentId, approved);
    setConfirm(null);
  };

  // cowork
  const [coworkGoal, setCoworkGoal] = useState('');
  const [jobUrl, setJobUrl] = useState<string | null>(null);
  const [coworkTrace, setCoworkTrace] = useState<string[]>([]);
  const [deliverable, setDeliverable] = useState('');
  const runCowork = async () => {
    if (!coworkGoal.trim()) return;
    setCoworkTrace([]); setDeliverable('');
    const { jobId } = await api.runCowork(coworkGoal.trim());
    setJobUrl(api.jobEventsUrl(jobId));
  };
  useSSE<Ev>(jobUrl, (ev) => {
    if (ev.type === 'plan') setCoworkTrace((t) => [...t, `📋 ${(ev.subgoals as string[])?.length ?? 0} sub-agents`]);
    else if (ev.type === 'subagent-start') setCoworkTrace((t) => [...t, `🤖 #${Number(ev.index) + 1} ${ev.subgoal}`]);
    else if (ev.type === 'subagent-result') setCoworkTrace((t) => [...t, `✓ #${Number(ev.index) + 1} done`]);
    else if (ev.type === 'file-written') setCoworkTrace((t) => [...t, `📄 ${ev.path} v${ev.version}`]);
    else if (ev.type === 'synthesize') setDeliverable(String(ev.text ?? ''));
    else if (ev.type === 'done' || ev.type === 'error') setJobUrl(null);
  });

  return (
    <div className="col">
      <Card title="Connectors" actions={<button className="ghost" onClick={() => void api.addStubConnector().then(loadConnectors)}>+ Demo MCP</button>}>
        <div className="row" aria-label="Add from catalog">
          <select aria-label="catalog" value={catId} onChange={(e) => setCatId(e.target.value)}>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input placeholder="server URL" value={catUrl} onChange={(e) => setCatUrl(e.target.value)} />
          <input placeholder="token (optional)" value={catToken} onChange={(e) => setCatToken(e.target.value)} />
          <button onClick={() => void installFromCatalog()} disabled={!catId || !catUrl.trim()}>Add from catalog</button>
        </div>
        {catalog.find((c) => c.id === catId)?.description && <div className="muted">{catalog.find((c) => c.id === catId)!.description}</div>}
        {catErr && <div className="error">{catErr}</div>}
        {connectors.length === 0 ? <Empty>No connectors.</Empty> : connectors.map((c) => (
          <div key={c.id} className="step row" style={{ justifyContent: 'space-between' }}>
            <span>{c.enabled ? '🟢' : '⚪️'} {c.name} <span className="muted">({c.tools.length} tools)</span> {health[c.id] && <span className="badge">{health[c.id]}</span>}</span>
            <span className="row">
              <button className="ghost" onClick={() => void checkHealth(c.id)}>health</button>
              <button className="ghost" onClick={() => void api.toggleConnector(c.id, !c.enabled).then(loadConnectors)}>{c.enabled ? 'disable' : 'enable'}</button>
              <button className="ghost" onClick={() => void api.deleteConnector(c.id).then(loadConnectors)}>✕</button>
            </span>
          </div>
        ))}
      </Card>

      <Card title="Agent">
        <div className="row">
          <input className="grow" placeholder="Agent goal, e.g. “save a note about EVs”" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <button onClick={() => void runAgent()} disabled={!goal.trim()}>Run agent</button>
        </div>
        {confirm && (
          <div className="row" role="alertdialog">
            <span>⏸ confirm <strong>{confirm.tool}</strong> [{confirm.risk}]?</span>
            <button onClick={() => void respond(true)}>Approve</button>
            <button className="ghost" onClick={() => void respond(false)}>Deny</button>
          </div>
        )}
        <div className="col">{trace.length === 0 ? <Empty>—</Empty> : trace.map((t, i) => <div key={i} className="step">{t}</div>)}</div>
        {audit.length > 0 && <div className="muted">{audit.map((a, i) => <div key={i}>{a.tool}: {a.decision} → {a.status}</div>)}</div>}
      </Card>

      <Card title="Plugins">
        <div className="row">
          {official.map((p) => (
            <button key={p.name} className="ghost" onClick={() => void api.installPlugin(p.name).then(loadPlugins)}>+ {p.name}</button>
          ))}
        </div>
        {installed.length === 0 ? <Empty>No plugins installed.</Empty> : installed.map((p) => (
          <div key={p.name} className="step row" style={{ justifyContent: 'space-between' }}>
            <span>🧩 {p.name}</span>
            <button className="ghost" onClick={() => void api.uninstallPlugin(p.name).then(loadPlugins)}>✕</button>
          </div>
        ))}
      </Card>

      <Card title="Cowork">
        <div className="row">
          <input className="grow" placeholder="Cowork goal, e.g. “Research the EV market across 3 angles and write a brief”" value={coworkGoal} onChange={(e) => setCoworkGoal(e.target.value)} />
          <button onClick={() => void runCowork()} disabled={!coworkGoal.trim()}>Run Cowork</button>
        </div>
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="col">{coworkTrace.length === 0 ? <Empty>—</Empty> : coworkTrace.map((t, i) => <div key={i} className="step">{t}</div>)}</div>
          <div>{deliverable ? <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{deliverable}</pre> : <Empty>Deliverable appears here.</Empty>}</div>
        </div>
      </Card>
    </div>
  );
}
