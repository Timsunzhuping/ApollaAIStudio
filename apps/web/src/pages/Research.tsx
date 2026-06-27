import { useEffect, useState } from 'react';
import { api, type Project } from '../lib/api';
import { useSSE } from '../lib/sse';
import { Card, Field, ErrorMsg } from '../components/ui';
import { Markdown } from '../components/Markdown';

interface Source { id: string; title?: string; url?: string }
type Ev = { type: string } & Record<string, unknown>;

export function Research() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<{ name: string }[]>([]);
  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState('');
  const [skill, setSkill] = useState('');

  const [taskId, setTaskId] = useState<string | null>(null);
  const [eventsUrl, setEventsUrl] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [plan, setPlan] = useState<string[]>([]);
  const [report, setReport] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [cost, setCost] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [media, setMedia] = useState<string | null>(null);

  useEffect(() => {
    void api.projects().then(setProjects).catch(() => {});
    void api.skills().then(setSkills).catch(() => {});
  }, []);

  const run = async () => {
    if (!question.trim()) return;
    setRunning(true);
    setError(null);
    setSteps([]); setPlan([]); setReport(''); setSources([]); setCost(0); setMedia(null);
    try {
      const { taskId: id } = skill ? await api.runSkill(skill, question) : await api.createTask(question, projectId || undefined);
      setTaskId(id);
      setEventsUrl(api.taskEventsUrl(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
      setRunning(false);
    }
  };

  useSSE<Ev>(eventsUrl, (ev) => {
    switch (ev.type) {
      case 'step-start': setSteps((s) => [...s, String(ev.state)]); break;
      case 'plan': setPlan(((ev.plan as { subquestions?: string[] })?.subquestions) ?? []); break;
      case 'delta': setReport((r) => r + String(ev.text ?? '')); break;
      case 'sources': setSources((ev.sources as Source[]) ?? []); break;
      case 'cost': setCost(Number(ev.totalUsd ?? 0)); break;
      case 'done': setRunning(false); setEventsUrl(null); break;
      case 'error': setError(String(ev.message ?? 'error')); setRunning(false); setEventsUrl(null); break;
    }
  });

  const genMedia = async (alias: string, confirm = false) => {
    if (!taskId) return;
    const r = await api.taskMedia(taskId, alias, confirm);
    if (r.requiresConfirmation) {
      if (window.confirm(`Estimated $${(r.estimateUsd ?? 0).toFixed(2)} — generate?`)) return genMedia(alias, true);
      return;
    }
    if (r.mediaId) { setMedia('generating…'); setMediaUrl(api.mediaEventsUrl(r.mediaId)); }
  };
  useSSE<Ev>(mediaUrl, (ev) => {
    if (ev.type === 'asset') {
      const assets = (ev.assets as { kind: string; uri: string }[]) ?? [];
      setMedia(assets.map((a) => a.uri).join('\n'));
    } else if (ev.type === 'done' || ev.type === 'error') setMediaUrl(null);
  });

  const saveSkill = async () => {
    if (!taskId) return;
    const s = await api.saveAsSkill(taskId);
    setSkills(await api.skills());
    setSkill(s.name);
  };

  return (
    <div className="col">
      <Card title="Research">
        <div className="row">
          <input className="grow" placeholder="Ask a research question, e.g. “State of the EV market in 2026”" value={question}
            onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
          <button onClick={() => void run()} disabled={running || !question.trim()}>{running ? 'Researching…' : 'Research'}</button>
        </div>
        <div className="row">
          <Field label="Project">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Rerun skill">
            <select value={skill} onChange={(e) => setSkill(e.target.value)}>
              <option value="">No skill</option>
              {skills.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Card>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '0.75rem' }}>
        <Card title="Trace">
          {plan.length > 0 && <div className="muted" style={{ marginBottom: '0.5rem' }}>{plan.map((p, i) => <div key={i}>• {p}</div>)}</div>}
          {steps.length === 0 ? <span className="muted">—</span> : steps.map((s, i) => <div key={i} className="step">{s}</div>)}
        </Card>
        <Card title="Report">
          {report ? <Markdown>{report}</Markdown> : <span className="muted">Enter a question to begin.</span>}
          {taskId && !running && (
            <div className="row" style={{ marginTop: '0.5rem' }}>
              <a className="badge" href={api.exportUrl(taskId, 'md')}>Export .md</a>
              <a className="badge" href={api.exportUrl(taskId, 'html')}>Export .html</a>
              <button className="ghost" onClick={() => void saveSkill()}>★ Save as skill</button>
              <button className="ghost" onClick={() => void genMedia('image_premium')}>🖼 Cover</button>
              <button className="ghost" onClick={() => void genMedia('video_standard')}>🎬 Video</button>
            </div>
          )}
          {media && <pre className="muted" style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{media}</pre>}
        </Card>
        <Card title="Sources">
          <span className="cost badge">${cost.toFixed(4)}</span>
          {sources.length === 0 ? <div className="muted">—</div> : sources.map((s) => (
            <div key={s.id} className="step">
              <span className="badge">[{s.id}]</span> {s.title}
              {s.url && <div><a href={s.url} target="_blank" rel="noopener">{s.url}</a></div>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
