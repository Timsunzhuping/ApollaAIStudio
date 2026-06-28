/** Per-document collaborator access (S21). The owner always has access; others must be granted. */
export interface CollabAccessRepository {
  grant(docId: string, userId: string): Promise<void>;
  has(docId: string, userId: string): Promise<boolean>;
  list(docId: string): Promise<string[]>;
}

export class InMemoryCollabAccessRepository implements CollabAccessRepository {
  private readonly byDoc = new Map<string, Set<string>>();
  async grant(docId: string, userId: string): Promise<void> {
    const s = this.byDoc.get(docId) ?? new Set<string>();
    s.add(userId);
    this.byDoc.set(docId, s);
  }
  async has(docId: string, userId: string): Promise<boolean> {
    return this.byDoc.get(docId)?.has(userId) ?? false;
  }
  async list(docId: string): Promise<string[]> {
    return [...(this.byDoc.get(docId) ?? [])];
  }
}
