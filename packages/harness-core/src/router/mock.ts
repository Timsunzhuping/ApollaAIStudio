import type { LLMRequest } from '@apolla/contracts';
import type { LLMAdapter, LLMStream, JsonResult, CallOpts, TokenUsage } from './types';

const USAGE: TokenUsage = { tokensIn: 10, tokensOut: 5 };

export interface MockBehavior {
  /** Text to stream/return; split into chunks for stream(). */
  text?: string;
  /** Throw this many times (across calls) before succeeding — simulates rate-limit/key failure. */
  failFirst?: number;
  /** Error message used while failing. */
  error?: string;
  /** Sequence of json() outputs; advances per call (simulates invalid-then-valid). */
  jsonSequence?: string[];
}

/** In-memory adapter for unit tests — never hits the network. */
export class MockAdapter implements LLMAdapter {
  private failsLeft: number;
  private jsonCall = 0;
  /** Records every (modelId, apiKey) the router invoked, for assertions. */
  readonly calls: Array<{ modelId: string; apiKey: string }> = [];

  constructor(
    readonly provider: string,
    private readonly behavior: MockBehavior = {},
  ) {
    this.failsLeft = behavior.failFirst ?? 0;
  }

  private maybeFail(modelId: string, opts: CallOpts) {
    this.calls.push({ modelId, apiKey: opts.apiKey });
    if (this.failsLeft > 0) {
      this.failsLeft -= 1;
      throw new Error(this.behavior.error ?? 'mock failure');
    }
  }

  stream(modelId: string, _req: LLMRequest, opts: CallOpts): LLMStream {
    this.maybeFail(modelId, opts);
    const text = this.behavior.text ?? 'ok';
    async function* gen() {
      for (const ch of text.split(' ')) yield { delta: ch + ' ', done: false };
      yield { delta: '', done: true };
    }
    return { stream: gen(), usage: Promise.resolve(USAGE) };
  }

  async json(modelId: string, _req: LLMRequest, _schema: object, opts: CallOpts): Promise<JsonResult> {
    this.maybeFail(modelId, opts);
    const seq = this.behavior.jsonSequence;
    const text = seq ? (seq[Math.min(this.jsonCall, seq.length - 1)] ?? '{}') : (this.behavior.text ?? '{}');
    this.jsonCall += 1;
    return { text, usage: USAGE };
  }
}
