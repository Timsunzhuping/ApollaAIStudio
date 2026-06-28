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

  // Two-factor authentication (S20)
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [enroll, setEnroll] = useState<{ secret: string; otpauthUri: string; recoveryCodes: string[] } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const startEnroll = async () => { setMfaError(null); setEnroll(await api.mfaEnroll()); };
  const confirmEnroll = async () => {
    try { await api.mfaVerify(mfaCode.trim()); setMfaEnabled(true); setEnroll(null); setMfaCode(''); }
    catch (e) { setMfaError(e instanceof Error ? e.message : 'invalid code'); }
  };
  const disableMfa = async () => {
    try { await api.mfaDisable(mfaCode.trim()); setMfaEnabled(false); setMfaCode(''); }
    catch (e) { setMfaError(e instanceof Error ? e.message : 'invalid code'); }
  };

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
    void api.me().then((u) => { setIdentities(u.identities ?? []); setMfaEnabled(u.mfaEnabled ?? false); }).catch(() => {});
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
      <Card title="Two-factor authentication">
        {mfaEnabled ? (
          <>
            <div className="row"><span className="badge">✓ Enabled</span></div>
            <span className="muted">Enter a current code to turn it off.</span>
            <div className="row">
              <input inputMode="numeric" placeholder="code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
              <button className="ghost" disabled={!mfaCode.trim()} onClick={() => void disableMfa()}>Disable</button>
            </div>
          </>
        ) : enroll ? (
          <>
            <span className="muted">Scan this in your authenticator app, then enter a code to confirm.</span>
            <Field label="Setup key (otpauth)"><input readOnly value={enroll.otpauthUri} /></Field>
            <span className="muted">Backup codes (save these — shown once):</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>{enroll.recoveryCodes.map((c) => <span key={c} className="badge">{c}</span>)}</div>
            <div className="row">
              <input inputMode="numeric" placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
              <button disabled={!mfaCode.trim()} onClick={() => void confirmEnroll()}>Confirm</button>
            </div>
          </>
        ) : (
          <>
            <span className="muted">Add a second factor (TOTP authenticator app) to your account.</span>
            <div className="row"><button onClick={() => void startEnroll()}>Enable two-factor</button></div>
          </>
        )}
        {mfaError && <span className="muted" style={{ color: 'var(--danger, #c00)' }}>{mfaError}</span>}
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
