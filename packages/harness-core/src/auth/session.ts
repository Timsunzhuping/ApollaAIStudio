import type { Session } from '@apolla/contracts';

/** Server-side session store — enables expiry + revocation (logout deletes the session). */
export interface SessionRepository {
  create(session: Session): Promise<void>;
  /** Returns the session only if it exists AND has not expired (relative to `now`). */
  get(id: string, now?: Date): Promise<Session | undefined>;
  delete(id: string): Promise<void>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();

  async create(session: Session): Promise<void> {
    this.byId.set(session.id, { ...session });
  }
  async get(id: string, now: Date = new Date()): Promise<Session | undefined> {
    const s = this.byId.get(id);
    if (!s) return undefined;
    if (new Date(s.expiresAt).getTime() <= now.getTime()) {
      this.byId.delete(id);
      return undefined;
    }
    return { ...s };
  }
  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}
