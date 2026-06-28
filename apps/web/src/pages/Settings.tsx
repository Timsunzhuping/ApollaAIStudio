import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, Field } from '../components/ui';

export function Settings() {
  const [language, setLanguage] = useState('');
  const [style, setStyle] = useState('');
  const [saved, setSaved] = useState(false);

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
  }, []);

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
      <Card title="API tokens">
        <span className="muted">For the browser extension / CLI. The token is shown once — copy it now.</span>
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
