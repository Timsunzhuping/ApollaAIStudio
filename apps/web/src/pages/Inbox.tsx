import { useEffect, useState } from 'react';
import { api, type TaskSummary } from '../lib/api';
import { Card, ErrorMsg } from '../components/ui';
import { Markdown } from '../components/Markdown';

const STATE_META: Record<string, { label: string; color: string }> = {
  done: { label: '完成', color: 'var(--ok)' },
  failed: { label: '失败', color: 'var(--danger)' },
  plan: { label: '运行中', color: 'var(--accent)' },
  search: { label: '运行中', color: 'var(--accent)' },
  extract: { label: '运行中', color: 'var(--accent)' },
  compare: { label: '运行中', color: 'var(--accent)' },
  generate: { label: '运行中', color: 'var(--accent)' },
  deliver: { label: '运行中', color: 'var(--accent)' },
};

type Filter = 'all' | 'done' | 'failed';

export function Inbox() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.tasks().then(setTasks).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setReport(null);
      return;
    }
    setOpenId(id);
    setReport(null);
    try {
      const t = await api.task(id);
      setReport(t.artifacts[0]?.content ?? '_（无成品 — 任务未完成）_');
    } catch {
      setReport('_加载失败_');
    }
  };

  const visible = tasks.filter((t) => (filter === 'all' ? true : filter === 'done' ? t.state === 'done' : t.state === 'failed'));

  return (
    <div className="col">
      <Card title="Inbox">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          {(['all', 'done', 'failed'] as Filter[]).map((f) => (
            <button key={f} className={`chip${filter === f ? ' active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? `全部 ${tasks.length}` : f === 'done' ? `完成 ${tasks.filter((t) => t.state === 'done').length}` : `失败 ${tasks.filter((t) => t.state === 'failed').length}`}
            </button>
          ))}
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
        {visible.length === 0 && <span className="muted">还没有任务 — 去 Research 页发起第一个研究。</span>}
        {visible.map((t) => {
          const meta = STATE_META[t.state] ?? { label: t.state, color: 'var(--muted)' };
          return (
            <div key={t.id} className="step">
              <button
                className="row"
                style={{ width: '100%', background: 'none', border: 'none', padding: 0, textAlign: 'left', fontWeight: 500 }}
                aria-expanded={openId === t.id}
                onClick={() => void toggle(t.id)}
              >
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: meta.color, flex: 'none' }} />
                <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.question ?? t.id}</span>
                <span className="badge">{meta.label}</span>
                {t.citations > 0 && <span className="badge">{t.citations} 引用</span>}
                <span className="badge cost">${t.totalCostUsd.toFixed(4)}</span>
                {t.createdAt && <span className="muted" style={{ fontSize: '0.75rem' }}>{t.createdAt.slice(0, 16).replace('T', ' ')}</span>}
              </button>
              {openId === t.id && (
                <div style={{ marginTop: '0.5rem', paddingLeft: '1.1rem' }}>
                  {report === null ? (
                    <span className="muted">加载中…</span>
                  ) : (
                    <>
                      <Markdown>{report}</Markdown>
                      {t.state === 'done' && (
                        <div className="row" style={{ marginTop: '0.5rem' }}>
                          <a className="badge" href={api.exportUrl(t.id, 'md')}>Export .md</a>
                          <a className="badge" href={api.exportUrl(t.id, 'html')}>Export .html</a>
                          <a className="badge" href={api.exportUrl(t.id, 'docx')}>Export .docx</a>
                          <a className="badge" href={api.exportUrl(t.id, 'pptx')}>Export .pptx</a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
