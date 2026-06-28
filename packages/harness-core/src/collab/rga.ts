/**
 * A Replicated Growable Array (RGA) text CRDT (S21). Each character has a globally-unique id
 * (`replica:counter`); an insert names the id it comes after; deletes tombstone. State is a pure
 * function of the SET of ops — applying the same ops in ANY order converges to the same text — so
 * sync over an unordered/at-least-once channel (SSE) is correct.
 */
export interface InsertOp {
  type: 'ins';
  id: string;
  after: string | null; // the element this comes after; null = document start
  ch: string;
}
export interface DeleteOp {
  type: 'del';
  id: string; // the element to tombstone
}
export type CollabOp = InsertOp | DeleteOp;

interface Elem {
  id: string;
  after: string | null;
  ch: string;
  deleted: boolean;
}

function parseId(id: string): { r: string; c: number } {
  const i = id.lastIndexOf(':');
  return { r: id.slice(0, i), c: Number(id.slice(i + 1)) };
}
/** Total order over ids (counter, then replica) — the deterministic tie-break for concurrent inserts. */
function cmpId(a: string, b: string): number {
  const A = parseId(a);
  const B = parseId(b);
  if (A.c !== B.c) return A.c - B.c;
  return A.r < B.r ? -1 : A.r > B.r ? 1 : 0;
}

export class Rga {
  private readonly elems = new Map<string, Elem>();
  private readonly seenIns = new Set<string>();
  private readonly tombstoned = new Set<string>(); // delete may arrive before its insert

  /** Apply one op. Returns true if it changed state (idempotent: replays return false). */
  apply(op: CollabOp): boolean {
    if (op.type === 'ins') {
      if (this.seenIns.has(op.id)) return false;
      this.seenIns.add(op.id);
      this.elems.set(op.id, { id: op.id, after: op.after, ch: op.ch, deleted: this.tombstoned.has(op.id) });
      return true;
    }
    if (this.tombstoned.has(op.id)) return false;
    this.tombstoned.add(op.id);
    const e = this.elems.get(op.id);
    if (e) e.deleted = true; // else it will be created already-deleted when the insert arrives
    return true;
  }

  applyMany(ops: CollabOp[]): void {
    for (const op of ops) this.apply(op);
  }

  /** Visible (non-tombstoned) element ids in document order — index ↔ id mapping for editors. */
  visibleIds(): string[] {
    const children = new Map<string | null, Elem[]>();
    for (const e of this.elems.values()) {
      const arr = children.get(e.after) ?? [];
      arr.push(e);
      children.set(e.after, arr);
    }
    for (const arr of children.values()) arr.sort((a, b) => cmpId(b.id, a.id)); // larger id first
    const out: string[] = [];
    const walk = (after: string | null): void => {
      for (const e of children.get(after) ?? []) {
        if (!e.deleted) out.push(e.id);
        walk(e.id);
      }
    };
    walk(null);
    return out;
  }

  text(): string {
    const byId = this.elems;
    return this.visibleIds()
      .map((id) => byId.get(id)!.ch)
      .join('');
  }
}

/** A local editor's replica: tracks a counter + replica id and produces ops for index-based edits. */
export class Replica {
  readonly rga = new Rga();
  private counter = 0;
  constructor(readonly id: string) {}

  insertAt(index: number, ch: string): InsertOp {
    const ids = this.rga.visibleIds();
    const after = index > 0 ? ids[index - 1] ?? null : null;
    const op: InsertOp = { type: 'ins', id: `${this.id}:${++this.counter}`, after, ch };
    this.rga.apply(op);
    return op;
  }

  /** Generate insert ops for a whole string typed at `index` (left to right). */
  insertStringAt(index: number, s: string): InsertOp[] {
    const ops: InsertOp[] = [];
    for (let i = 0; i < s.length; i++) ops.push(this.insertAt(index + i, s[i]!));
    return ops;
  }

  deleteAt(index: number): DeleteOp | null {
    const id = this.rga.visibleIds()[index];
    if (!id) return null;
    const op: DeleteOp = { type: 'del', id };
    this.rga.apply(op);
    return op;
  }

  apply(op: CollabOp): boolean {
    return this.rga.apply(op);
  }
  text(): string {
    return this.rga.text();
  }
}
