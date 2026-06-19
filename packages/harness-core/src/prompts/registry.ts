import { loadPrompts } from '@apolla/config';
import type { PromptVersion } from '@apolla/contracts';

export interface GetOpts {
  /** Pin an exact version, bypassing rollout selection. */
  pin?: string;
  /** RNG in [0,1) for canary selection. Defaults to 0 (always newest active) for determinism. */
  rand?: () => number;
}

/** Rendered prompt: filled template text + the resolved PromptVersion (for schema/metadata). */
export interface RenderedPrompt {
  text: string;
  prompt: PromptVersion;
}

function compareVersionDesc(a: string, b: string): number {
  // Numeric-aware where possible (e.g. "2" > "10"? no — numeric compare), else lexical.
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
  return b.localeCompare(a);
}

/**
 * Prompt Registry (ARCHITECTURE §3.3). Prompts are declarative assets loaded from
 * @apolla/config (packages/config/prompts/*.md) — NEVER inlined in business code.
 * `get` resolves a version honoring an explicit pin or a rollout-based canary.
 */
export class PromptRegistry {
  private readonly byId = new Map<string, PromptVersion[]>();

  constructor(prompts?: PromptVersion[]) {
    this.load(prompts ?? loadPrompts());
  }

  /** Replace the registry contents (e.g. on config reload). */
  load(prompts: PromptVersion[]): void {
    this.byId.clear();
    for (const p of prompts) {
      const list = this.byId.get(p.promptId) ?? [];
      list.push(p);
      this.byId.set(p.promptId, list);
    }
    for (const [, list] of this.byId) list.sort((a, b) => compareVersionDesc(a.version, b.version));
  }

  /** All prompt ids known to the registry. */
  ids(): string[] {
    return [...this.byId.keys()];
  }

  /** Versions of a prompt, newest first. */
  versions(promptId: string): PromptVersion[] {
    return this.byId.get(promptId) ?? [];
  }

  /**
   * Resolve a prompt version.
   * - `pin` → that exact version (throws if absent).
   * - otherwise → walk versions newest-first and serve the first whose `rollout` covers `rand()`.
   *   With the default `rand` (0) this is the newest active version; pass `Math.random` in
   *   production for gradual canary rollout.
   */
  get(promptId: string, opts: GetOpts = {}): PromptVersion {
    const list = this.byId.get(promptId);
    if (!list || list.length === 0) throw new Error(`Unknown promptId: ${promptId}`);

    if (opts.pin) {
      const pinned = list.find((p) => p.version === opts.pin);
      if (!pinned) throw new Error(`Unknown prompt version: ${promptId}@${opts.pin}`);
      return pinned;
    }

    const r = (opts.rand ?? (() => 0))();
    for (const p of list) {
      if (p.rollout > 0 && r < p.rollout) return p;
    }
    const fallback = list.filter((p) => p.rollout > 0).at(-1);
    if (!fallback) throw new Error(`No active (rollout > 0) version for promptId: ${promptId}`);
    return fallback;
  }

  /** Resolve + fill `{{var}}` placeholders. Missing vars throw so prompts never ship half-filled. */
  render(promptId: string, vars: Record<string, string> = {}, opts: GetOpts = {}): RenderedPrompt {
    const prompt = this.get(promptId, opts);
    const text = prompt.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
      if (!(key in vars)) throw new Error(`Missing variable "${key}" for prompt ${promptId}`);
      return vars[key]!;
    });
    return { text, prompt };
  }
}
