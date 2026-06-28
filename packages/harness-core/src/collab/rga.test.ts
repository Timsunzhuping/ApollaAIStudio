import { describe, it, expect } from 'vitest';
import { Rga, Replica, type CollabOp } from './rga';

/** Apply ops to a fresh Rga in a given order and return the text. */
function replay(ops: CollabOp[]): string {
  const r = new Rga();
  r.applyMany(ops);
  return r.text();
}
/** A few deterministic permutations of an op list. */
function permutations(ops: CollabOp[]): CollabOp[][] {
  const reversed = [...ops].reverse();
  const rotated = [...ops.slice(3), ...ops.slice(0, 3)];
  const interleaved = ops.filter((_, i) => i % 2 === 0).concat(ops.filter((_, i) => i % 2 === 1));
  return [ops, reversed, rotated, interleaved];
}

describe('RGA text CRDT (S21)', () => {
  it('records typed text in order (single replica)', () => {
    const a = new Replica('a');
    a.insertStringAt(0, 'hello');
    expect(a.text()).toBe('hello');
    a.deleteAt(0); // delete 'h'
    expect(a.text()).toBe('ello');
    a.insertAt(0, 'H');
    expect(a.text()).toBe('Hello');
  });

  it('converges regardless of op delivery order (concurrent edits)', () => {
    // Two replicas each type at the start of an empty doc, then exchange ops.
    const a = new Replica('aaa');
    const b = new Replica('bbb');
    const aOps = a.insertStringAt(0, 'cat');
    const bOps = b.insertStringAt(0, 'dog');
    const all = [...aOps, ...bOps];

    const texts = permutations(all).map(replay);
    // every ordering yields the same (converged) text...
    expect(new Set(texts).size).toBe(1);
    // ...and both replicas, after applying the other's ops, agree with it.
    b.rga.applyMany(aOps);
    a.rga.applyMany(bOps);
    expect(a.text()).toBe(b.text());
    expect(a.text()).toBe(texts[0]);
  });

  it('converges with concurrent deletes (delete may arrive before its insert)', () => {
    const a = new Replica('a');
    const ins = a.insertStringAt(0, 'abc');
    const delB = a.deleteAt(1)!; // delete 'b'
    const ops = [...ins, delB];
    for (const order of permutations(ops)) expect(replay(order)).toBe('ac');
  });

  it('is idempotent — replayed ops do not duplicate', () => {
    const a = new Replica('a');
    const ops = a.insertStringAt(0, 'hi');
    const r = new Rga();
    r.applyMany([...ops, ...ops, ...ops]);
    expect(r.text()).toBe('hi');
  });
});
