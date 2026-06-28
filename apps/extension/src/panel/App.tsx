import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { realChrome, readConfig, writeConfig, type ChromeFacade } from '../lib/chrome';
import { createApi } from '../lib/api';
import { planAction, type Plan } from '../lib/actions';
import type { PageContext } from '../content';

interface Source { id: string; title?: string; url?: string }

export function App({ facade = realChrome }: { facade?: ChromeFacade }) {
  const [base, setBase] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [label, setLabel] = useState<string | null>(null);
  const [report, setReport] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');

  const api = createApi(facade);

  const run = async (plan: Plan) => {
    setError(null); setRunning(true); setReport(''); setSources([]); setSavedPath(null); setLabel(plan.label);
    try {
      if (plan.kind === 'research') {
        const { taskId } = await api.createTask(plan.question);
        await api.streamTask(taskId, (e) => {
          if (e.type === 'delta') setReport((r) => r + String(e.text ?? ''));
          else if (e.type === 'sources') setSources((e.sources as Source[]) ?? []);
        });
      } else {
        const r = await api.runSurface(plan.surfaceId, plan.text, plan.params);
        const file = await api.workspaceFile(r.path);
        setReport(file.content);
        setSavedPath(r.path);
      }
    } catch {
      setError('request failed — check your connection settings');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void (async () => {
      const cfg = await readConfig(facade);
      setBase(cfg.base); setToken(cfg.token);
      if (!cfg.token) { setShowSettings(true); return; }
      const { pendingAction } = await facade.storageGet(['pendingAction']);
      const pa = pendingAction as { action: string; context: PageContext } | undefined;
      if (pa) {
        await facade.storageSet({ pendingAction: null });
        await run(planAction(pa.action, pa.context));
      }
    })();
  }, [facade]);

  const saveSettings = async () => {
    await writeConfig(facade, { base: base.trim(), token: token.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Apolla AI</h1>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>⚙</button>
      </div>

      {showSettings && (
        <div className="card">
          <h2>Connection</h2>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:3000" />
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="apolla_…" style={{ marginTop: '0.4rem' }} />
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button onClick={() => void saveSettings()}>Save</button>
            {saved && <span className="ok">saved</span>}
          </div>
          <div className="muted" style={{ marginTop: '0.4rem' }}>Create a token in Apolla → Settings → API tokens.</div>
        </div>
      )}

      <div className="card">
        <div className="row">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask anything, or select text on the page" />
          <button disabled={running || !question.trim()} onClick={() => void run({ kind: 'research', question: question.trim(), label: 'Research' })}>Go</button>
        </div>
      </div>

      {label && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{label}{running ? '…' : ''}</h2>
            {savedPath && <span className="badge">saved {savedPath}</span>}
          </div>
          {error ? <div className="error">{error}</div> : report ? <div className="markdown"><ReactMarkdown>{report}</ReactMarkdown></div> : <div className="muted">working…</div>}
          {sources.length > 0 && (
            <div style={{ marginTop: '0.4rem' }}>
              {sources.map((s) => <div key={s.id} className="muted"><span className="badge">[{s.id}]</span> {s.title}</div>)}
            </div>
          )}
        </div>
      )}
      <div className="muted">Select text on any page → right-click → “Research / Translate / Summarize with Apolla”.</div>
    </div>
  );
}
