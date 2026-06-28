import { useEffect, useRef, useState } from 'react';
import { Replica, type CollabOp } from '@apolla/harness-core/collab';
import { api } from '../lib/api';
import { useSSE } from '../lib/sse';
import { Card, Field, ErrorMsg } from '../components/ui';

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
  const [docId, setDocId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replica = useRef<Replica>(new Replica(`web-${Math.random().toString(36).slice(2, 8)}`));
  const sinceRef = useRef(0);
  const [eventsUrl, setEventsUrl] = useState<string | null>(null);

  // Accept a share link landing (/collab/accept?token=…) or open ?doc=…
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
      sinceRef.current = state.seq;
      setText(replica.current.text());
      setParticipants(state.participants);
      setOpen(id);
      setEventsUrl(api.collabEventsUrl(id, state.seq)); // live updates from where we synced
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not open document');
    }
  };

  // Live remote ops + presence.
  useSSE<{ ops: CollabOp[]; seq: number; participants: string[] }>(eventsUrl, (ev) => {
    let changed = false;
    for (const op of ev.ops ?? []) if (replica.current.apply(op)) changed = true;
    if (changed) setText(replica.current.text());
    if (ev.participants) setParticipants(ev.participants);
  });

  const onEdit = (next: string) => {
    setText(next);
    const ops = changeToOps(replica.current, next);
    if (ops.length && open) void api.collabPushOps(open, ops).catch(() => {});
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
      <Card title={`Document ${open}`} actions={<button className="ghost" onClick={() => { setOpen(null); setEventsUrl(null); setShareLink(null); }}>← Documents</button>}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" data-testid="participants">{participants.length} editing</span>
          <button className="ghost" onClick={() => void share()}>🔗 Share</button>
        </div>
        {shareLink && <Field label="Share link"><input readOnly value={shareLink} /></Field>}
        <textarea data-testid="collab-editor" style={{ minHeight: '16rem', width: '100%' }} value={text} onChange={(e) => onEdit(e.target.value)} />
        {error && <ErrorMsg>{error}</ErrorMsg>}
      </Card>
    </div>
  );
}
