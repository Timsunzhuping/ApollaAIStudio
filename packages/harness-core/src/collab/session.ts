import { Rga, type CollabOp } from './rga';

/**
 * A live collaborative document (S21): the CRDT state + a canonical, append-only op log (server
 * arrival order). Clients pull `opsSince(cursor)` and apply them — since the CRDT converges for any
 * order, every client reaches the same text. Presence tracks who is currently editing.
 */
/** Live presence for one editor: when last seen + where their caret is + a display label/color (S31). */
export interface Presence {
  id: string;
  cursor: number;
  label: string;
  color: string;
}

/** Deterministic per-user color from a small palette (no RNG — same user → same color everywhere). */
function colorFor(userId: string): string {
  const palette = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#9a6324', '#800000'];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

export class CollabSession {
  private readonly rga = new Rga();
  private readonly log: CollabOp[] = [];
  private readonly present = new Map<string, { t: number; cursor: number; label: string }>();

  /** Apply + append ops (idempotent). Returns the new log length (sync cursor). */
  applyOps(ops: CollabOp[]): { seq: number } {
    for (const op of ops) if (this.rga.apply(op)) this.log.push(op);
    return { seq: this.log.length };
  }

  /** Ops the caller hasn't seen yet (its cursor = how many it has applied). */
  opsSince(cursor: number): CollabOp[] {
    return this.log.slice(Math.max(0, cursor));
  }

  get seq(): number {
    return this.log.length;
  }
  text(): string {
    return this.rga.text();
  }

  /** Mark a user present (heartbeat), optionally updating their caret position / display label. */
  join(userId: string, now = Date.now(), opts?: { cursor?: number; label?: string }): void {
    const prev = this.present.get(userId);
    this.present.set(userId, {
      t: now,
      cursor: opts?.cursor ?? prev?.cursor ?? 0,
      label: opts?.label ?? prev?.label ?? userId.slice(0, 8),
    });
  }
  /** Currently-present userIds (seen within `ttlMs`). Kept for back-compat (S21 callers). */
  participants(ttlMs = 15_000, now = Date.now()): string[] {
    return [...this.present.entries()].filter(([, p]) => now - p.t < ttlMs).map(([u]) => u).sort();
  }
  /** Rich presence: caret position + label + a stable per-user color (S31). */
  presence(ttlMs = 15_000, now = Date.now()): Presence[] {
    return [...this.present.entries()]
      .filter(([, p]) => now - p.t < ttlMs)
      .map(([id, p]) => ({ id, cursor: p.cursor, label: p.label, color: colorFor(id) }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Durable snapshot = the op log; restore replays it into a fresh session. */
  snapshot(): CollabOp[] {
    return [...this.log];
  }
  static restore(ops: CollabOp[]): CollabSession {
    const s = new CollabSession();
    s.applyOps(ops);
    return s;
  }
}

export interface CollabDoc {
  docId: string;
  ownerId: string;
  session: CollabSession;
}

export interface CollabRepository {
  getOrCreate(docId: string, ownerId: string): CollabDoc;
  get(docId: string): CollabDoc | undefined;
}

/** In-memory collab docs (sessions live while edited; persistence is a workspace snapshot, S21-T3). */
export class InMemoryCollabRepository implements CollabRepository {
  private readonly docs = new Map<string, CollabDoc>();
  getOrCreate(docId: string, ownerId: string): CollabDoc {
    let doc = this.docs.get(docId);
    if (!doc) {
      doc = { docId, ownerId, session: new CollabSession() };
      this.docs.set(docId, doc);
    }
    return doc;
  }
  get(docId: string): CollabDoc | undefined {
    return this.docs.get(docId);
  }
}
