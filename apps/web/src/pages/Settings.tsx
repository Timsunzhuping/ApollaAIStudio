import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, Field } from '../components/ui';

export function Settings() {
  const [language, setLanguage] = useState('');
  const [style, setStyle] = useState('');
  const [saved, setSaved] = useState(false);

  // Linked sign-in identities (S14)
  const [identities, setIdentities] = useState<{ provider: string }[]>([]);

  // MCP server: expose Apolla's capabilities to MCP clients (S18)
  const [mcpTools, setMcpTools] = useState<{ name: string; description: string }[]>([]);

  // API tokens (browser extension / CLI)
  const [tokens, setTokens] = useState<{ id: string; name: string }[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const loadTokens = () => api.tokens().then(setTokens).catch(() => {});
  const createToken = async () => {
    const t = await api.createToken(tokenName.trim() || 'token');
    setNewToken(t.token);
    setTokenName('');
    await loadTokens();
  };

  useEffect(() => {
    void api.getMemoryModel().then((m) => {
      setLanguage(String((m as { language?: string }).language ?? ''));
      setStyle(String((m as { style?: string }).style ?? ''));
    }).catch(() => {});
    void loadTokens();
    void api.me().then((u) => setIdentities(u.identities ?? [])).catch(() => {});
    void api.mcpManifest().then((m) => setMcpTools(m.tools ?? [])).catch(() => {});
  }, []);

  const mcpUrl = `${window.location.origin}/api/mcp`;

  const save = async () => {
    await api.setMemoryModel({ language, style });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="col">
      <Card title="Writing preferences">
        <span className="muted">Future research and drafts reflect these.</span>
        <Field label="Preferred language"><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English, Chinese" /></Field>
        <Field label="Preferred style"><input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. concise bullets" /></Field>
        <div className="row">
          <button onClick={() => void save()}>Save preferences</button>
          {saved && <span className="badge">✓ saved</span>}
        </div>
      </Card>
      <Card title="Linked accounts">
        <span className="muted">Single sign-on identities connected to your account.</span>
        {identities.length === 0 ? (
          <span className="muted">No SSO providers linked.</span>
        ) : (
          <div className="row">{identities.map((i) => <span key={i.provider} className="badge">{i.provider}</span>)}</div>
        )}
      </Card>
      <Card title="MCP server">
        <span className="muted">Connect Apolla to any MCP client (Claude Desktop, Cursor, …) with an API token — your research, translate, and skills become callable tools.</span>
        <Field label="Endpoint"><input readOnly value={mcpUrl} /></Field>
        {mcpTools.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap' }}>{mcpTools.map((t) => <span key={t.name} className="badge" title={t.description}>{t.name}</span>)}</div>
        )}
        <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em' }}>{JSON.stringify({ mcpServers: { apolla: { url: mcpUrl, headers: { Authorization: 'Bearer <your API token>' } } } }, null, 2)}</pre>
      </Card>
      <Card title="API tokens">
        <span className="muted">For the browser extension / CLI / MCP. The token is shown once — copy it now.</span>
        <div className="row">
          <input placeholder="token name (e.g. browser extension)" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
          <button onClick={() => void createToken()}>Create token</button>
        </div>
        {newToken && <pre className="badge" style={{ whiteSpace: 'pre-wrap' }}>{newToken}</pre>}
        {tokens.length === 0 ? <span className="muted">No tokens.</span> : tokens.map((t) => (
          <div key={t.id} className="step row" style={{ justifyContent: 'space-between' }}>
            <span>🔑 {t.name}</span>
            <button className="ghost" onClick={() => void api.deleteToken(t.id).then(loadTokens)}>revoke</button>
          </div>
        ))}
      </Card>
      <Card title="Memory">
        <span className="muted">Clear all remembered notes for your account.</span>
        <div><button className="ghost" onClick={() => void api.clearMemory()}>Clear memory</button></div>
      </Card>
    </div>
  );
}
