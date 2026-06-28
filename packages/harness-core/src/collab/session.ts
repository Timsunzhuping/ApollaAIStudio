import { Rga, type CollabOp } from './rga';

/**
 * A live collaborative document (S21): the CRDT state + a canonical, append-only op log (server
 * arrival order). Clients pull `opsSince(cursor)` and apply them — since the CRDT converges for any
 * order, every client reaches the same text. Presence tracks who is currently editing.
 */
export class CollabSession {
  private readonly rga = new Rga();
  private readonly log: CollabOp[] = [];
  private readonly present = new Map<string, number>(); // userId -> last-seen ms

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

  join(userId: string, now = Date.now()): void {
    this.present.set(userId, now);
  }
  /** Currently-present userIds (seen within `ttlMs`). */
  participants(ttlMs = 15_000, now = Date.now()): string[] {
    return [...this.present.entries()].filter(([, t]) => now - t < ttlMs).map(([u]) => u).sort();
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
