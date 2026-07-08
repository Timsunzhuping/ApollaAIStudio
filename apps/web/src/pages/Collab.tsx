import { useEffect, useRef, useState } from 'react';
import { Replica, type CollabOp } from '@apolla/harness-core/collab';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSSE } from '../lib/sse';
import { Card, Field, ErrorMsg } from '../components/ui';

interface RemotePresence { id: string; cursor: number; label: string; color: string }

/** Diff the textarea against the CRDT's current text → ops (prefix/suffix diff). Mutates the replica. */
function changeToOps(replica: Replica, next: string): CollabOp[] {
  const prev = replica.text();
  if (prev === next) return [];
  let p = 0;
  while (p < prev.length && p < next.length && prev[p] === next[p]) p++;
  let s = 0;
  while (s < prev.length - p && s < next.length - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  const removed = prev.length - p - s;
  const inserted = next.slice(p, next.length - s);
  const ops: CollabOp[] = [];
  for (let i = 0; i < removed; i++) { const op = replica.deleteAt(p); if (op) ops.push(op); }
  if (inserted) ops.push(...replica.insertStringAt(p, inserted));
  return ops;
}

export function Collab() {
  const { user } = useAuth();
  const [docId, setDocId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [presence, setPresence] = useState<RemotePresence[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replica = useRef<Replica>(new Replica(`web-${Math.random().toString(36).slice(2, 8)}`));
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef<string | null>(null);
  const label = (user?.email ?? 'guest').split('@')[0]!;
  const [eventsUrl, setEventsUrl] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const doc = params.get('doc');
    if (token) void api.collabAccept(token).then((r) => openDoc(r.docId)).catch((e) => setError(String(e.message ?? e)));
    else if (doc) void openDoc(doc);
  }, []);

  const openDoc = async (id: string) => {
    setError(null);
    try {
      replica.current = new Replica(`web-${Math.random().toString(36).slice(2, 8)}`);
      const state = await api.collabGet(id, 0);
      for (const op of state.ops) replica.current.apply(op as CollabOp);
      setText(replica.current.text());
      setOpen(id);
      openRef.current = id;
      setEventsUrl(api.collabEventsUrl(id, state.seq));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not open document');
    }
  };

  // Live remote ops + rich presence (other editors' carets).
  useSSE<{ ops: CollabOp[]; seq: number; presence?: RemotePresence[] }>(eventsUrl, (ev) => {
    let changed = false;
    for (const op of ev.ops ?? []) if (replica.current.apply(op)) changed = true;
    if (changed) setText(replica.current.text());
    if (ev.presence) setPresence(ev.presence.filter((p) => p.id !== user?.id));
  });

  const reportCursor = () => {
    const el = editorRef.current;
    if (!el || !openRef.current) return;
    void api.collabPresence(openRef.current, el.selectionStart, label).catch(() => {});
  };

  const onEdit = (next: string) => {
    setText(next);
    const ops = changeToOps(replica.current, next);
    const caret = editorRef.current?.selectionStart ?? 0;
    if (ops.length && openRef.current) void api.collabPushOps(openRef.current, ops, caret, label).catch(() => {});
  };

  const share = async () => {
    if (!open) return;
    try { setShareLink((await api.collabShare(open)).link); } catch (e) { setError(e instanceof Error ? e.message : 'share failed'); }
  };

  if (!open) {
    return (
      <div className="col">
        <Card title="Collaborative documents">
          <span className="muted">Open a shared document by id, or start a new one — edits sync live to everyone with access.</span>
          <div className="row">
            <input className="grow" placeholder="document id" value={docId} onChange={(e) => setDocId(e.target.value)} />
            <button disabled={!docId.trim()} onClick={() => void openDoc(docId.trim())}>Open</button>
            <button className="ghost" onClick={() => void openDoc(`doc-${Math.random().toString(36).slice(2, 10)}`)}>New document</button>
          </div>
          {error && <ErrorMsg>{error}</ErrorMsg>}
        </Card>
      </div>
    );
  }

  return (
    <div className="col">
      <Card title={`Document ${open}`} actions={<button className="ghost" onClick={() => { setOpen(null); openRef.current = null; setEventsUrl(null); setShareLink(null); setPresence([]); }}>← Documents</button>}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" data-testid="presence" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
            <span className="muted">{presence.length + 1} editing:</span>
            <span className="chip" style={{ background: '#8884', padding: '0 .4rem', borderRadius: '.6rem' }}>{label} (you)</span>
            {presence.map((p) => (
              <span key={p.id} className="chip" data-testid={`peer-${p.id}`} title={`caret at ${p.cursor}`}
                style={{ background: p.color + '33', borderLeft: `3px solid ${p.color}`, padding: '0 .4rem', borderRadius: '.6rem' }}>
                {p.label} · {p.cursor}
              </span>
            ))}
          </div>
          <button className="ghost" onClick={() => void share()}>🔗 Share</button>
        </div>
        {shareLink && <Field label="Share link"><input readOnly value={shareLink} /></Field>}

        <div className="collab-editor-wrap" style={{ position: 'relative' }}>
          {/* Remote-caret overlay: a mirror of the text with a colored bar at each peer's caret. */}
          <div aria-hidden className="collab-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: 'inherit', padding: '0.5rem', color: 'transparent', overflow: 'hidden' }}>
            {presence.map((p) => {
              const c = Math.min(p.cursor, text.length);
              return (
                <span key={p.id}>
                  {text.slice(0, c)}
                  <span style={{ borderLeft: `2px solid ${p.color}`, marginLeft: -1 }}>
                    <span style={{ position: 'absolute', fontSize: '0.6rem', background: p.color, color: '#fff', padding: '0 3px', borderRadius: 3, transform: 'translateY(-1em)' }}>{p.label}</span>
                  </span>
                </span>
              );
            })}
          </div>
          <textarea
            ref={editorRef}
            data-testid="collab-editor"
            style={{ minHeight: '16rem', width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '0.5rem', position: 'relative', background: 'transparent' }}
            value={text}
            onChange={(e) => onEdit(e.target.value)}
            onSelect={reportCursor}
            onKeyUp={reportCursor}
            onClick={reportCursor}
          />
        </div>
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Card>
    </div>
  );
}
