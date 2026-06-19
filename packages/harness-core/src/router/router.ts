import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMRequest, LLMChunk, RouteConfig, ModelAlias } from '@apolla/contracts';
import { getRoute } from '@apolla/config';
import type { LLMAdapter, AttemptLog, TokenUsage } from './types';
import { ModelRouterError } from './types';
import { resolveKeyPairs } from './keys';

export interface UsageEvent extends TokenUsage {
  alias: ModelAlias;
  provider: string;
  modelId: string;
  kind: 'llm';
}

export interface RouterDeps {
  /** provider name -> adapter. Injected at the composition root. */
  adapters: Map<string, LLMAdapter>;
  env?: NodeJS.ProcessEnv;
  /** Override route resolution (defaults to @apolla/config getRoute). Handy for tests. */
  routeFor?: (alias: ModelAlias) => RouteConfig;
  /** Cost Ledger hook (Sprint 01 T8 wires the real ledger here). */
  onUsage?: (event: UsageEvent) => void;
  /** Corrective retries for json() when output fails schema validation. Default 2. */
  jsonMaxRetries?: number;
}

function parseModelId(id: string): { provider: string; model: string } {
  const i = id.indexOf('/');
  if (i <= 0 || i === id.length - 1) {
    throw new Error(`Invalid model id (expected "provider/model"): ${id}`);
  }
  return { provider: id.slice(0, i), model: id.slice(i + 1) };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Strip ```json fences a model may wrap around structured output. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

/**
 * The Model Router. Business code calls it with a logical alias only — never a model id.
 * Responsibilities: alias→route resolution, failover chain, key rotation, structured-output
 * validation with corrective retries, and usage accounting. See ARCHITECTURE §3.1.
 */
export class ModelRouter {
  private readonly adapters: Map<string, LLMAdapter>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly routeFor: (alias: ModelAlias) => RouteConfig;
  private readonly onUsage?: (event: UsageEvent) => void;
  private readonly jsonMaxRetries: number;

  constructor(deps: RouterDeps) {
    this.adapters = deps.adapters;
    this.env = deps.env ?? process.env;
    this.routeFor = deps.routeFor ?? getRoute;
    this.onUsage = deps.onUsage;
    this.jsonMaxRetries = deps.jsonMaxRetries ?? 2;
  }

  private candidates(route: RouteConfig): string[] {
    return [route.primary, ...route.fallbackChain];
  }

  /** Stream a completion, failing over across candidates and keys until one succeeds. */
  async *complete(alias: ModelAlias, req: LLMRequest): AsyncIterable<LLMChunk> {
    const route = this.routeFor(alias);
    const attempts: AttemptLog[] = [];

    for (const modelId of this.candidates(route)) {
      const { provider, model } = parseModelId(modelId);
      const adapter = this.adapters.get(provider);
      if (!adapter) {
        attempts.push({ modelId, provider, error: 'no adapter registered' });
        continue;
      }
      const keys = resolveKeyPairs(provider, route, this.env);
      if (keys.length === 0) {
        attempts.push({ modelId, provider, error: 'no api key available' });
        continue;
      }

      for (const key of keys) {
        let yielded = false;
        try {
          const s = adapter.stream(model, req, { apiKey: key.value });
          for await (const chunk of s.stream) {
            yielded = true;
            yield chunk;
          }
          const usage = await s.usage;
          this.onUsage?.({ ...usage, alias, provider, modelId, kind: 'llm' });
          return;
        } catch (e) {
          // Cannot safely fail over once bytes have been emitted to the caller.
          if (yielded) throw e;
          attempts.push({ modelId, provider, keyName: key.name, error: errMsg(e) });
        }
      }
    }

    throw new ModelRouterError(`complete() exhausted all candidates for "${alias}"`, attempts);
  }

  /** Convenience: collect a streamed completion into a single string. */
  async completeText(alias: ModelAlias, req: LLMRequest): Promise<string> {
    let out = '';
    for await (const chunk of this.complete(alias, req)) out += chunk.delta;
    return out;
  }

  /**
   * Structured output: returns a value validated against `schema`. On invalid output the router
   * retries with the validation error fed back, then fails over to the next candidate.
   */
  async json<T>(alias: ModelAlias, req: LLMRequest, schema: z.ZodType<T>): Promise<T> {
    const route = this.routeFor(alias);
    const jsonSchema = zodToJsonSchema(schema, 'Result');
    const attempts: AttemptLog[] = [];

    for (const modelId of this.candidates(route)) {
      const { provider, model } = parseModelId(modelId);
      const adapter = this.adapters.get(provider);
      if (!adapter) {
        attempts.push({ modelId, provider, error: 'no adapter registered' });
        continue;
      }
      const keys = resolveKeyPairs(provider, route, this.env);
      if (keys.length === 0) {
        attempts.push({ modelId, provider, error: 'no api key available' });
        continue;
      }
      const key = keys[0]!;
      let attemptReq = req;
      let lastErr = '';

      for (let i = 0; i <= this.jsonMaxRetries; i++) {
        try {
          const { text, usage } = await adapter.json(model, attemptReq, jsonSchema, {
            apiKey: key.value,
          });
          const parsed = schema.safeParse(JSON.parse(stripFences(text)));
          if (parsed.success) {
            this.onUsage?.({ ...usage, alias, provider, modelId, kind: 'llm' });
            return parsed.data;
          }
          lastErr = parsed.error.message;
        } catch (e) {
          lastErr = errMsg(e);
        }
        attemptReq = {
          ...req,
          messages: [
            ...req.messages,
            {
              role: 'user',
              content: `Your previous response was not valid against the required JSON schema (${lastErr}). Respond again with ONLY a valid JSON object that conforms exactly.`,
            },
          ],
        };
      }
      attempts.push({ modelId, provider, keyName: key.name, error: lastErr });
    }

    throw new ModelRouterError(`json() exhausted all candidates for "${alias}"`, attempts);
  }
}
