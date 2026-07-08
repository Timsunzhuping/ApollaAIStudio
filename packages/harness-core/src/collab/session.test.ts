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

  it('presence carries caret position + a stable per-user color, updatable independently (S31)', () => {
    const s = new CollabSession();
    s.join('alice', 1000, { cursor: 3, label: 'Alice' });
    s.join('bob', 1000, { cursor: 0, label: 'Bob' });
    const p = s.presence(15_000, 1500);
    expect(p.map((x) => x.id)).toEqual(['alice', 'bob']);
    const alice = p.find((x) => x.id === 'alice')!;
    expect(alice).toMatchObject({ cursor: 3, label: 'Alice' });
    expect(alice.color).toMatch(/^#[0-9a-f]{6}$/);
    // color is deterministic per user
    expect(s.presence(15_000, 1600).find((x) => x.id === 'alice')!.color).toBe(alice.color);
    // a bare heartbeat keeps the caret; a new opts moves it
    s.join('alice', 2000);
    expect(s.presence(15_000, 2100).find((x) => x.id === 'alice')!.cursor).toBe(3);
    s.join('alice', 2200, { cursor: 7 });
    expect(s.presence(15_000, 2300).find((x) => x.id === 'alice')!.cursor).toBe(7);
    // stale presence drops out
    expect(s.presence(15_000, 100_000)).toEqual([]);
  });
});
