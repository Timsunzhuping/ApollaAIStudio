import { useEffect, useState } from 'react';
import { realChrome, readConfig, writeConfig, type ChromeFacade } from '../lib/chrome';
import { createApi } from '../lib/api';

export function App({ facade = realChrome }: { facade?: ChromeFacade }) {
  const [base, setBase] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = createApi(facade);

  useEffect(() => {
    void readConfig(facade).then((c) => { setBase(c.base); setToken(c.token); });
  }, [facade]);

  const save = async () => {
    setError(null);
    await writeConfig(facade, { base: base.trim(), token: token.trim() });
    setStatus('saved');
  };
  const test = async () => {
    setError(null);
    setStatus(null);
    try {
      const me = await api.me();
      setStatus(`connected as ${me.email}`);
    } catch {
      setError('connection failed — check the URL and token');
    }
  };

  return (
    <div className="wrap">
      <h1>Apolla AI</h1>
      <div className="card">
        <h2>Connection</h2>
        <label className="muted">BFF URL</label>
        <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:3000" />
        <label className="muted" style={{ marginTop: '0.4rem', display: 'block' }}>API token</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="apolla_…" />
        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button onClick={() => void save()}>Save</button>
          <button className="ghost" onClick={() => void test()} disabled={!token.trim()}>Test connection</button>
        </div>
        {status && <div className="ok">{status}</div>}
        {error && <div className="error">{error}</div>}
        <div className="muted" style={{ marginTop: '0.4rem' }}>
          Create a token in Apolla → Settings → API tokens, then paste it here.
        </div>
      </div>
      <div className="muted">Select text on any page, then right-click → “Research / Translate / Summarize with Apolla”.</div>
    </div>
  );
}
