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

  // Voice I/O (S19): dictate the question, read the report aloud.
  const voiceSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined';
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        void transcribeBlob(blob, mr.mimeType || 'audio/webm');
      };
      mr.start();
      setRecorder(mr);
      setRecording(true);
    } catch {
      setError('Microphone unavailable.');
    }
  };
  const stopRecording = () => { recorder?.stop(); setRecording(false); setRecorder(null); };

  // The transcript is UNTRUSTED DATA — it only fills the question input; the user still submits.
  const transcribeBlob = async (blob: Blob, mime: string) => {
    setVoiceBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(blob);
      });
      const { text } = await api.transcribe(dataUrl.split(',')[1] ?? '', mime);
      setQuestion((q) => (q ? `${q} ${text}` : text));
    } catch {
      setError('Transcription failed.');
    } finally {
      setVoiceBusy(false);
    }
  };

  const readAloud = async () => {
    if (!report.trim()) return;
    setVoiceBusy(true);
    try {
      const { uri } = await api.synthesize(report);
      setAudioSrc(api.base + uri);
    } catch {
      setError('Read-aloud failed.');
    } finally {
      setVoiceBusy(false);
    }
  };

  useEffect(() => {
    void api.projects().then(setProjects).catch(() => {});
    void api.skills().then(setSkills).catch(() => {});
  }, []);

  const run = async () => {
    if (!question.trim()) return;
    setRunning(true);
    setError(null);
    setSteps([]); setPlan([]); setReport(''); setSources([]); setCost(0); setMedia(null); setFeedback(null);
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

  // Feedback (S29): one verdict per task; feeds the effective-workflow metric.
  const [feedback, setFeedback] = useState<string | null>(null);
  const sendFeedback = async (verdict: 'up' | 'down') => {
    if (!taskId) return;
    try {
      await api.sendFeedback(taskId, verdict);
      setFeedback(verdict);
    } catch {
      setError('Feedback failed.');
    }
  };

  // Idle = nothing started yet → show the launcher hero + examples instead of empty result cards (QW2).
  const started = running || !!taskId;
  const EXAMPLES = [
    '2026 年电动车市场现状与主要玩家',
    '对比 Notion 与 Obsidian 的核心差异与适用人群',
    '面试准备：产品经理岗位的常见问题清单',
    '固态电池的商业化进展到哪一步了？',
  ];

  return (
    <div className="col">
      <Card title="Research">
        <div className="row">
          <input className="grow" placeholder="Ask a research question, e.g. “State of the EV market in 2026”" value={question}
            onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
          {voiceSupported && (
            <button className="ghost" aria-label={recording ? 'Stop recording' : 'Dictate question'} title="Dictate your question"
              disabled={voiceBusy} onClick={() => (recording ? stopRecording() : void startRecording())}>
              {recording ? '⏹ Stop' : voiceBusy ? '…' : '🎤'}
            </button>
          )}
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
        {!started && (
          <div style={{ marginTop: '0.5rem' }}>
            <div className="example-label">Try one of these</div>
            <div className="chips">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => setQuestion(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Card>

      {!started ? (
        <Card>
          <p className="muted" style={{ margin: 0 }}>
            输入一个研究问题，Apolla 会自动拆解、检索、抓取来源并生成带引用的报告 —— 完成后可导出、存为技能或生成配图。
          </p>
        </Card>
      ) : (
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
              <button className="ghost" disabled={voiceBusy} onClick={() => void readAloud()}>🔊 Read aloud</button>
              <span style={{ marginLeft: 'auto' }} />
              {feedback ? (
                <span className="muted" data-testid="feedback-thanks">Thanks for the feedback</span>
              ) : (
                <>
                  <button className="ghost" aria-label="Helpful" title="Helpful" onClick={() => void sendFeedback('up')}>👍</button>
                  <button className="ghost" aria-label="Not helpful" title="Not helpful" onClick={() => void sendFeedback('down')}>👎</button>
                </>
              )}
            </div>
          )}
          {audioSrc && <audio data-testid="report-audio" src={audioSrc} controls style={{ marginTop: '0.5rem', width: '100%' }} />}
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
      )}
    </div>
  );
}
