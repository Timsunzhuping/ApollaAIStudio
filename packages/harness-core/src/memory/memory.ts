import type { MemoryItem, UserModel } from '@apolla/contracts';
import type { Memory } from './types';

let seq = 0;

/** In-memory Memory with naive word-overlap recall — the reference impl + test/offline default. */
export class InMemoryMemory implements Memory {
  private readonly items = new Map<string, MemoryItem[]>();
  private readonly models = new Map<string, UserModel>();

  async recall(ownerId: string, query: string, limit = 5): Promise<MemoryItem[]> {
    const terms = tokens(query);
    return (this.items.get(ownerId) ?? [])
      .map((item) => ({ item, score: overlap(tokens(item.content), terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => structuredClone(x.item));
  }

  async note(item: { ownerId: string; content: string; kind?: 'note' | 'fact' }): Promise<void> {
    seq += 1;
    const list = this.items.get(item.ownerId) ?? [];
    list.push({ id: `mem_${seq}`, ownerId: item.ownerId, kind: item.kind ?? 'note', content: item.content });
    this.items.set(item.ownerId, list);
  }

  async getUserModel(ownerId: string): Promise<UserModel | undefined> {
    const m = this.models.get(ownerId);
    return m ? structuredClone(m) : undefined;
  }

  async setUserModel(ownerId: string, patch: Partial<Omit<UserModel, 'ownerId'>>): Promise<UserModel> {
    const current = this.models.get(ownerId) ?? { ownerId, formats: [] };
    const next: UserModel = { ...current, ...patch, ownerId };
    this.models.set(ownerId, next);
    return structuredClone(next);
  }

  async clear(ownerId: string): Promise<void> {
    this.items.delete(ownerId);
    this.models.delete(ownerId);
  }
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of b) if (a.has(t)) n += 1;
  return n;
}
