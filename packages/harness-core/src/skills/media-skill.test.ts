import { describe, it, expect } from 'vitest';
import type { MediaAlias, MediaRouteConfig, SkillDef } from '@apolla/contracts';
import { SkillRuntime } from './runtime';
import { makeMediaExecutor, makeGenericExecutor } from './executors';
import { MediaOrchestrator } from '../media/orchestrator';
import { MediaRouter } from '../media/router';
import { StubMediaAdapter } from '../media/stub';
import { InMemoryObjectStore } from '../media/store';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { InMemoryMediaRepository, CompositeSkillSource, InMemorySkillRepository } from '../repo/memory';
import type { SkillEvent } from './types';

const coverSkill: SkillDef = {
  name: 'cover-image',
  triggers: ['cover image', '生成封面'],
  tools: [],
  io: {},
  risk: 'read',
  promptRef: 'summarize',
  executor: 'media',
  mediaAlias: 'image_premium',
};

const mediaRoute = (alias: MediaAlias): MediaRouteConfig => ({ alias, primary: 'stub/x', fallbackChain: [], keyPool: [] });

function build() {
  const mediaOrch = new MediaOrchestrator({
    router: new MediaRouter({ adapters: new Map([['stub', new StubMediaAdapter()]]), env: {}, routeFor: mediaRoute }),
    repo: new InMemoryMediaRepository(),
    store: new InMemoryObjectStore(),
    idGen: () => 'mskill',
  });
  const genericRouter = new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { text: '- point' })]]),
    env: { K: 'k' },
    routeFor: (a) => ({ alias: a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }),
  });
  const runtime = new SkillRuntime(
    new CompositeSkillSource([coverSkill], new InMemorySkillRepository()),
    makeGenericExecutor({ router: genericRouter, prompts: new PromptRegistry([{ promptId: 'summarize', version: '1', scene: 's', template: 't', safetyConstraints: [], rollout: 1 }]) }),
  );
  runtime.registerExecutor('media', makeMediaExecutor(mediaOrch));
  return runtime;
}

async function collect(it: AsyncIterable<SkillEvent>): Promise<SkillEvent[]> {
  const out: SkillEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('media skills', () => {
  it('matches a media skill by trigger', async () => {
    const hits = await build().match('please make a cover image for this');
    expect(hits.map((s) => s.name)).toContain('cover-image');
  });

  it('runs a media skill through the MediaOrchestrator, emitting media events', async () => {
    const runtime = build();
    const skill = (await runtime.get('cover-image'))!;
    const events = await collect(runtime.run(skill, { ownerId: 'u', question: 'EV market report' }));
    const types = events.map((e) => e.type);
    expect(types).toContain('submitted');
    expect(types).toContain('asset');
    expect(types.at(-1)).toBe('done');
  });
});
