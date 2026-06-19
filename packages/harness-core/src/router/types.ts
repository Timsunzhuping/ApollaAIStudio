import type { LLMRequest, LLMChunk } from '@apolla/contracts';

export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface CallOpts {
  apiKey: string;
  signal?: AbortSignal;
}

/** A streaming completion: chunks plus a usage promise that resolves once the stream ends. */
export interface LLMStream {
  stream: AsyncIterable<LLMChunk>;
  usage: Promise<TokenUsage>;
}

export interface JsonResult {
  /** Raw model text expected to contain a JSON object; validated/parsed by the router. */
  text: string;
  usage: TokenUsage;
}

/**
 * A provider adapter. harness-core NEVER imports concrete adapters — they are injected into
 * the router (composition root). Adapters take a concrete model id; the alias→id mapping and
 * key/failover policy live in the router. See ARCHITECTURE §3.1.
 */
export interface LLMAdapter {
  readonly provider: string;
  stream(modelId: string, req: LLMRequest, opts: CallOpts): LLMStream;
  json(modelId: string, req: LLMRequest, jsonSchema: object, opts: CallOpts): Promise<JsonResult>;
}

export interface AttemptLog {
  modelId: string;
  provider: string;
  keyName?: string;
  error: string;
}

/** Thrown when every candidate (primary + fallbackChain) × key fails. Carries the attempt log. */
export class ModelRouterError extends Error {
  constructor(
    message: string,
    readonly attempts: AttemptLog[],
  ) {
    super(`${message} :: ${attempts.map((a) => `${a.modelId}[${a.error}]`).join(' -> ')}`);
    this.name = 'ModelRouterError';
  }
}
