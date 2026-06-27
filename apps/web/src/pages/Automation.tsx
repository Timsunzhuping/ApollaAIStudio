import { useEffect, useState } from 'react';
import { api, type ScheduledTask, type Job, type Notification } from '../lib/api';
import { useSSE } from '../lib/sse';
import { Card, Field, Empty } from '../components/ui';

type Ev = { type: string } & Record<string, unknown>;

export function Automation() {
  const [schedules, setSchedules] = useState<ScheduledTask[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [question, setQuestion] = useState('');
  const [cron, setCron] = useState('0 8 * * *');
  const [jobUrl, setJobUrl] = useState<string | null>(null);
  const [jobTrace, setJobTrace] = useState<string[]>([]);

  const loadSchedules = () => api.schedules().then(setSchedules).catch(() => {});
  const loadJobs = () => api.jobs().then(setJobs).catch(() => {});
  const loadNotifs = () => api.notifications().then(setNotifs).catch(() => {});
  const refresh = () => { void loadSchedules(); void loadJobs(); void loadNotifs(); };
  useEffect(refresh, []);

  const addSchedule = async () => {
    if (!question.trim()) return;
    await api.createSchedule({ name: question.slice(0, 40), cron, kind: 'research', input: { question } });
    setQuestion('');
    await loadSchedules();
  };
  const openJob = (id: string) => { setJobTrace([]); setJobUrl(api.jobEventsUrl(id)); };
  useSSE<Ev>(jobUrl, (ev) => {
    setJobTrace((t) => [...t, ev.type === 'delta' ? `💬 ${ev.text}` : ev.type]);
    if (ev.type === 'done' || ev.type === 'error') setJobUrl(null);
  });

  const unread = notifs.filter((n) => !n.read).length;

  return (
    <div className="col">
      <Card title="Schedule a daily research" actions={<button className="ghost" onClick={refresh}>↻ Refresh</button>}>
        <div className="row">
          <input className="grow" placeholder="Daily research question" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Field label="Cron (UTC)"><input value={cron} onChange={(e) => setCron(e.target.value)} /></Field>
          <button onClick={() => void addSchedule()} disabled={!question.trim()}>+ Add</button>
        </div>
      </Card>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
        <Card title="Schedules">
          {schedules.length === 0 ? <Empty>—</Empty> : schedules.map((s) => (
            <div key={s.id} className="step">
              {s.enabled ? '🟢' : '⚪️'} {s.name || s.cron} <span className="muted">· {s.cron}</span>
              <div className="row">
                <button className="ghost" onClick={() => void api.runSchedule(s.id).then(loadJobs)}>run now</button>
                <button className="ghost" onClick={() => void api.toggleSchedule(s.id, !s.enabled).then(loadSchedules)}>{s.enabled ? 'pause' : 'resume'}</button>
                <button className="ghost" onClick={() => void api.deleteSchedule(s.id).then(loadSchedules)}>✕</button>
              </div>
            </div>
          ))}
        </Card>
        <Card title="Job history">
          {jobs.length === 0 ? <Empty>—</Empty> : jobs.slice(0, 20).map((j) => (
            <div key={j.id} className="step">
              <a href="#" onClick={(e) => { e.preventDefault(); openJob(j.id); }}>{j.kind}</a> <span className="badge">{j.status}</span>
            </div>
          ))}
          {jobTrace.length > 0 && <pre className="muted" style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{jobTrace.join('\n')}</pre>}
        </Card>
        <Card title={`Notifications (🔔 ${unread})`}>
          {notifs.length === 0 ? <Empty>—</Empty> : notifs.slice(0, 20).map((n) => (
            <div key={n.id} className={`step${n.read ? ' done' : ''}`}>
              {n.read ? '· ' : '• '}{n.title}
              {!n.read && <button className="ghost" onClick={() => void api.readNotification(n.id).then(loadNotifs)}>read</button>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
