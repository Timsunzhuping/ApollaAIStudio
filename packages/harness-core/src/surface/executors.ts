import type { ModelAlias } from '@apolla/contracts';
import { assembleRequest } from '../safety/untrusted';
import type { SurfaceExecCtx, SurfaceChunk } from './types';

/** Coerce arbitrary params into string vars for prompt placeholder substitution. */
function stringParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) out[k] = v == null ? '' : String(v);
  return out;
}

function inputAsData(content: string): { kind: 'untrusted'; sourceId: string; origin: string; content: string }[] {
  return [{ kind: 'untrusted', sourceId: 'surface:input', origin: 'surface:input', content }];
}

/**
 * Generic streaming executor: render the surface prompt, feed input as UNTRUSTED data, stream prose,
 * emit the accumulated result as the final content. Used by generic + translate surfaces.
 */
export async function* genericExecutor(ctx: SurfaceExecCtx, alias: ModelAlias = 'claude_write'): AsyncIterable<SurfaceChunk> {
  const system = ctx.prompts.render(ctx.surface.promptRef, stringParams(ctx.params)).text;
  const user = String(ctx.params.instruction ?? `Apply the "${ctx.surface.title || ctx.surface.id}" transformation.`);
  const req = assembleRequest({ system, user, data: inputAsData(ctx.inputContent) });
  let full = '';
  for await (const chunk of ctx.router.complete(alias, req)) {
    full += chunk.delta;
    yield { delta: chunk.delta };
  }
  yield { content: full.trim() || ctx.inputContent };
}

/**
 * Translate executor (S8-T2): translate the input into `targetLang`, preserving Markdown structure.
 * Streams prose; the prompt (surface.translate) is filled with {{targetLang}}/{{sourceLang}}.
 */
export async function* translateExecutor(ctx: SurfaceExecCtx, alias: ModelAlias = 'claude_write'): AsyncIterable<SurfaceChunk> {
  const vars = stringParams({ targetLang: ctx.params.targetLang ?? 'English', sourceLang: ctx.params.sourceLang ?? 'auto' });
  const system = ctx.prompts.render(ctx.surface.promptRef, vars).text;
  const user = `Translate the document below into ${vars.targetLang}. Preserve all Markdown structure.`;
  const req = assembleRequest({ system, user, data: inputAsData(ctx.inputContent) });
  let full = '';
  for await (const chunk of ctx.router.complete(alias, req)) {
    full += chunk.delta;
    yield { delta: chunk.delta };
  }
  yield { content: full.trim() || ctx.inputContent };
}
