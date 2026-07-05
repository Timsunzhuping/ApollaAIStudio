import { useEffect, useRef, useState } from 'react';
import { api, type ChatEvent, type ConversationSummary } from '../lib/api';
import { Card, ErrorMsg } from '../components/ui';
import { Markdown } from '../components/Markdown';

interface Turn { role: 'user' | 'assistant'; content: string }

export function Chat() {
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'auto' | 'gpt' | 'claude'>('auto');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = () => void api.conversations().then(setThreads).catch(() => {});
  useEffect(loadThreads, []);
  useEffect(() => {
    // jsdom has no scrollIntoView — guard so tests and odd embeds don't crash.
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const open = async (id: string) => {
    setActiveId(id);
    setError(null);
    try {
      const c = await api.conversation(id);
      setTurns(c.messages.filter((m): m is Turn => m.role !== 'system'));
    } catch {
      setError('Failed to load conversation.');
    }
  };

  const newThread = () => { setActiveId(null); setTurns([]); setError(null); };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);
    setStreaming(true);
    setTurns((t) => [...t, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      await api.chatStream({ conversationId: activeId ?? undefined, text, mode }, (ev: ChatEvent) => {
        if (ev.type === 'conversation') setActiveId(ev.conversationId);
        else if (ev.type === 'delta') {
          setTurns((t) => {
            const next = [...t];
            const last = next[next.length - 1]!;
            next[next.length - 1] = { ...last, content: last.content + ev.text };
            return next;
          });
        } else if (ev.type === 'error') setError(ev.message);
      });
      loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'chat failed');
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '0.75rem', height: '100%', minHeight: 0 }}>
      <Card title="Conversations">
        <button className="ghost" style={{ width: '100%', marginBottom: '0.5rem' }} onClick={newThread}>＋ New chat</button>
        <div className="col" style={{ gap: '0.15rem', overflowY: 'auto' }}>
          {threads.length === 0 && <span className="muted">No conversations yet.</span>}
          {threads.map((t) => (
            <button key={t.id} className={`navlink${t.id === activeId ? ' active' : ''}`} style={{ textAlign: 'left', border: 'none', background: t.id === activeId ? undefined : 'transparent', fontWeight: 400 }} onClick={() => void open(t.id)}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Chat">
        <div className="col" style={{ minHeight: '50vh', maxHeight: '65vh', overflowY: 'auto', gap: '0.75rem' }} data-testid="chat-thread">
          {turns.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              轻量对话入口 —— 快速问答、改写、头脑风暴。需要带来源核验的答案时，请用 Research。
            </p>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.role === 'user' ? 'flex-end' : 'stretch', maxWidth: t.role === 'user' ? '75%' : undefined }}>
              {t.role === 'user' ? (
                <div style={{ background: 'var(--accent-wash)', borderRadius: 12, padding: '0.5rem 0.9rem' }}>{t.content}</div>
              ) : (
                <div className="markdown"><Markdown>{t.content || '…'}</Markdown></div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <select aria-label="Model mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="auto">Auto</option>
            <option value="gpt">GPT</option>
            <option value="claude">Claude</option>
          </select>
          <input
            className="grow"
            placeholder="随便聊点什么…（Enter 发送）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          />
          <button onClick={() => void send()} disabled={streaming || !input.trim()}>{streaming ? '…' : 'Send'}</button>
        </div>
      </Card>
    </div>
  );
}
