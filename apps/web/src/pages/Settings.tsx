import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Field, ErrorMsg } from '../components/ui';
import { passkeySupported, registerPasskey } from '../lib/passkey';

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

  // Passkeys (S33)
  const [passkeys, setPasskeys] = useState<{ id: string; label: string }[]>([]);
  const [passkeyMsg, setPasskeyMsg] = useState<string | null>(null);
  const loadPasskeys = () => api.passkeyList().then(setPasskeys).catch(() => {});
  const addPasskey = async () => {
    setPasskeyMsg(null);
    try { await registerPasskey(); setPasskeyMsg('Passkey added.'); await loadPasskeys(); }
    catch (e) { setPasskeyMsg(e instanceof Error ? e.message : 'Could not add passkey.'); }
  };
  const removePasskey = async (id: string) => { await api.passkeyDelete(id).catch(() => {}); await loadPasskeys(); };

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
    void loadPasskeys();
    void api.me().then((u) => { setIdentities(u.identities ?? []); setMfaEnabled(u.mfaEnabled ?? false); }).catch(() => {});
    void api.mcpManifest().then((m) => setMcpTools(m.tools ?? [])).catch(() => {});
  }, []);

  // Your data (S22): export / import / delete account
  const { logout, user } = useAuth();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [delError, setDelError] = useState<string | null>(null);
  const exportData = async () => {
    const bundle = await api.accountExport();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'apolla-account-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importData = async (file: File) => {
    setImportMsg(null);
    try {
      const c = await api.accountImport(JSON.parse(await file.text()));
      setImportMsg(`Imported ${c.projects} projects, ${c.skills} skills, ${c.workspace} files.`);
    } catch {
      setImportMsg('Import failed — not a valid export file.');
    }
  };
  const deleteAccount = async () => {
    setDelError(null);
    try { await api.accountDelete(confirmEmail.trim()); await logout(); }
    catch (e) { setDelError(e instanceof Error ? e.message : 'deletion failed'); }
  };

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
      <Card title="Passkeys">
        <span className="muted">Sign in without a password using a device key (WebAuthn-style). The private key stays on this device.</span>
        {passkeys.length === 0 ? (
          <span className="muted" data-testid="passkey-empty">No passkeys yet.</span>
        ) : (
          <ul className="col" data-testid="passkey-list" style={{ gap: '0.3rem', listStyle: 'none', padding: 0 }}>
            {passkeys.map((p) => (
              <li key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>🔑 {p.label}</span>
                <button className="ghost" onClick={() => void removePasskey(p.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button data-testid="add-passkey" disabled={!passkeySupported()} onClick={() => void addPasskey()}>Add a passkey</button>
          {!passkeySupported() && <span className="muted">This browser doesn't support passkeys.</span>}
        </div>
        {passkeyMsg && <span className="muted" data-testid="passkey-msg">{passkeyMsg}</span>}
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

      <Card title="Your data">
        <span className="muted">Download a copy of your data, restore it from a previous export, or permanently delete your account.</span>
        <div className="row">
          <button onClick={() => void exportData()} data-testid="export-data">⬇ Export my data</button>
          <label className="button ghost" style={{ cursor: 'pointer' }}>
            ⬆ Import
            <input
              type="file"
              accept="application/json"
              data-testid="import-data"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); }}
            />
          </label>
        </div>
        {importMsg && <span className="muted" data-testid="import-msg">{importMsg}</span>}

        <div className="danger-zone" style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          {!dangerOpen ? (
            <button className="ghost" data-testid="delete-open" onClick={() => setDangerOpen(true)}>Delete account…</button>
          ) : (
            <div className="col">
              <span className="muted">This permanently deletes your account and all data. Type your email <strong>{user?.email}</strong> to confirm.</span>
              <Field label="Confirm email">
                <input value={confirmEmail} data-testid="delete-confirm" onChange={(e) => setConfirmEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              <div className="row">
                <button className="danger" data-testid="delete-submit" onClick={() => void deleteAccount()}>Permanently delete</button>
                <button className="ghost" onClick={() => { setDangerOpen(false); setConfirmEmail(''); setDelError(null); }}>Cancel</button>
              </div>
              {delError && <ErrorMsg>{delError}</ErrorMsg>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
