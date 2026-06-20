import type { MediaAsset } from '@apolla/contracts';

export interface PromptVerdict {
  allowed: boolean;
  reason?: string;
}

export interface AssetVerdict {
  flagged: boolean;
  reason?: string;
}

/**
 * Content moderation boundary (PRD §13, S3-T6). Pre-generation prompt screen (cheaper to refuse
 * than to generate-then-delete) + post-generation asset screen. Pluggable — a real moderation
 * provider slots in behind this; the rule-based default keeps offline/CI deterministic.
 */
export interface ContentModerator {
  screenPrompt(prompt: string): Promise<PromptVerdict>;
  screenAsset(asset: MediaAsset): Promise<AssetVerdict>;
}

const DEFAULT_BANNED = [
  'nsfw',
  'explicit',
  'pornographic',
  'gore',
  'child',
  'deepfake',
  'celebrity likeness',
];

/** Deterministic rule-based moderator (offline default). Real pixel-level screening is pluggable. */
export class RuleModerator implements ContentModerator {
  constructor(private readonly banned: string[] = DEFAULT_BANNED) {}

  async screenPrompt(prompt: string): Promise<PromptVerdict> {
    const lc = prompt.toLowerCase();
    const hit = this.banned.find((b) => lc.includes(b));
    return hit ? { allowed: false, reason: `prompt contains a disallowed term: "${hit}"` } : { allowed: true };
  }

  async screenAsset(_asset: MediaAsset): Promise<AssetVerdict> {
    return { flagged: false };
  }
}
