import { describe, it, expect } from 'vitest';
import { CollabSession, InMemoryCollabRepository } from './session';
import { Replica } from './rga';

describe('CollabSession (S21)', () => {
  it('two clients sync through the server log and converge', () => {
    const doc = new InMemoryCollabRepository().getOrCreate('d1', 'owner');
    const { session } = doc;
    const a = new Replica('a');
    const b = new Replica('b');

    // A types "hi" and pushes; B pulls from cursor 0 and applies.
    session.applyOps(a.insertStringAt(0, 'hi'));
    let bCursor = 0;
    for (const op of session.opsSince(bCursor)) b.apply(op);
    bCursor = session.seq;
    expect(b.text()).toBe('hi');

    // B appends " there" and pushes; A pulls.
    session.applyOps(b.insertStringAt(b.text().length, ' there'));
    let aCursor = 0;
    for (const op of session.opsSince(aCursor)) a.apply(op);
    aCursor = session.seq;
    expect(a.text()).toBe(session.text());
    expect(a.text()).toBe('hi there');
  });

  it('opsSince is incremental and applyOps is idempotent', () => {
    const s = new CollabSession();
    const a = new Replica('a');
    const r = s.applyOps(a.insertStringAt(0, 'ab'));
    expect(r.seq).toBe(2);
    expect(s.opsSince(2)).toHaveLength(0);
    s.applyOps(a.rga.visibleIds().length ? [] : []); // no-op
    s.applyOps([{ type: 'ins', id: 'a:1', after: null, ch: 'a' }]); // replay → ignored
    expect(s.seq).toBe(2);
  });

  it('presence reflects active participants; snapshot→restore preserves text', () => {
    const s = new CollabSession();
    const a = new Replica('a');
    s.applyOps(a.insertStringAt(0, 'doc'));
    s.join('u1', 1000);
    s.join('u2', 1000);
    expect(s.participants(15_000, 2000)).toEqual(['u1', 'u2']);
    expect(s.participants(15_000, 100_000)).toEqual([]); // stale → gone
    expect(CollabSession.restore(s.snapshot()).text()).toBe('doc');
  });
});
