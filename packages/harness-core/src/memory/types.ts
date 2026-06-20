import type { MemoryItem, UserModel } from '@apolla/contracts';

/** Persistent memory (ARCHITECTURE §3.7, PRD §12.B). Per-owner; editable; deletable. */
export interface Memory {
  /** Cross-session recall by relevance (FTS in Postgres; substring scoring in memory). */
  recall(ownerId: string, query: string, limit?: number): Promise<MemoryItem[]>;
  note(item: { ownerId: string; content: string; kind?: 'note' | 'fact' }): Promise<void>;
  getUserModel(ownerId: string): Promise<UserModel | undefined>;
  setUserModel(ownerId: string, patch: Partial<Omit<UserModel, 'ownerId'>>): Promise<UserModel>;
  /** Data control (PRD §8). */
  clear(ownerId: string): Promise<void>;
}

/** Render a user model as a trusted system directive (memory nudging into the instruction channel). */
export function userModelDirective(model: UserModel | undefined): string | undefined {
  if (!model) return undefined;
  const parts: string[] = [];
  if (model.language) parts.push(`Write in ${model.language}.`);
  if (model.style) parts.push(`Preferred style: ${model.style}.`);
  if (model.formats.length) parts.push(`Preferred formats: ${model.formats.join(', ')}.`);
  if (model.notes) parts.push(model.notes);
  return parts.length ? `User preferences — ${parts.join(' ')}` : undefined;
}
