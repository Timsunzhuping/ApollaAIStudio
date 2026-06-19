import type { LLMRequest, LLMMessage, UntrustedContent } from '@apolla/contracts';

/** Tag a raw string as untrusted data (origin-attributed). */
export function wrapAsData(content: string, origin: string, sourceId: string): UntrustedContent {
  return { kind: 'untrusted', sourceId, origin, content };
}

export interface AssembleParams {
  system?: string;
  user: string;
  /** External/untrusted content — placed ONLY in the data channel, never in messages. */
  data?: UntrustedContent[];
}

/**
 * Assemble an LLMRequest with a hard boundary: trusted instructions go in `messages`
 * (system/user), untrusted external content goes ONLY in `data`. This is the structural
 * defense against prompt injection (PRD §12.E / ARCHITECTURE §3.8) — the model layer is
 * responsible for treating `data` as evidence, never as instructions.
 */
export function assembleRequest(params: AssembleParams): LLMRequest {
  const messages: LLMMessage[] = [];
  if (params.system) messages.push({ role: 'system', content: params.system });
  messages.push({ role: 'user', content: params.user });
  return {
    messages,
    data: (params.data ?? []).map((d) => ({ sourceId: d.sourceId, content: d.content })),
  };
}

/**
 * Guard: assert no untrusted content leaked into the instruction channel (messages).
 * Used in tests and can be wired as a runtime invariant before dispatch.
 */
export function assertNoUntrustedInMessages(req: LLMRequest, untrusted: UntrustedContent[]): void {
  const haystack = req.messages.map((m) => m.content).join('\n');
  for (const u of untrusted) {
    if (haystack.includes(u.content)) {
      throw new Error(`Untrusted content (source ${u.sourceId}) leaked into the instruction channel`);
    }
  }
}
