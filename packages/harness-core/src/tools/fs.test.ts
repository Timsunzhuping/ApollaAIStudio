import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, AuditEntry } from '@apolla/contracts';
import { ToolRuntime } from './runtime';
import { makeWorkspaceTools } from './fs';
import { InMemoryWorkspaceRepository } from '../workspace/memory';
import { AgentOrchestrator } from '../agent/orchestrator';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
]);
function decisions(seq: object[]): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', { jsonSequence: seq.map((d) => JSON.stringify(d)) })]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}

describe('workspace tools', () => {
  it('fs_read returns file content via the untrusted data channel; risk=read', async () => {
    const ws = new InMemoryWorkspaceRepository();
    await ws.write({ ownerId: 'u', path: 'note.md', content: 'hello world' });
    const rt = new ToolRuntime();
    for (const t of makeWorkspaceTools(ws, { ownerId: 'u' })) rt.register(t);
    expect(rt.get('fs_read').risk).toBe('read');
    const r = await rt.invoke('fs_read', { path: 'note.md' });
    expect(r.ok).toBe(true);
    expect(r.data[0]?.kind).toBe('untrusted');
    expect(r.data[0]?.content).toBe('hello world');
  });

  it('fs_write is low_write — denied in background (no allowlist), executed when allowlisted', async () => {
    const run = async (allow: string[]): Promise<{ audited: AuditEntry[]; ws: InMemoryWorkspaceRepository }> => {
      const ws = new InMemoryWorkspaceRepository();
      const rt = new ToolRuntime();
      for (const t of makeWorkspaceTools(ws, { ownerId: 'u' })) rt.register(t);
      const router = decisions([
        { action: 'call_tool', tool: 'fs_write', args: { path: 'out.md', content: 'data' } },
        { action: 'finish', answer: 'done' },
      ]);
      const audited: AuditEntry[] = [];
      const set = new Set(allow);
      for await (const _e of new AgentOrchestrator({ router, tools: rt, prompts, audit: (e) => { audited.push(e); } }).run({ ownerId: 'u', goal: 'write', taskId: 't', approve: async (c) => set.has(c.tool) })) void _e;
      return { audited, ws };
    };
    const denied = await run([]); // background, no allowlist
    expect(denied.audited.some((e) => e.tool === 'fs_write' && e.status === 'executed')).toBe(false);
    expect(await denied.ws.read('u', 'out.md')).toBeUndefined();
    const allowed = await run(['fs_write']);
    expect(allowed.audited.some((e) => e.tool === 'fs_write' && e.status === 'executed')).toBe(true);
    expect((await allowed.ws.read('u', 'out.md'))?.content).toBe('data');
  });

  it('fs_write rejects a traversal path (no write, ok:false)', async () => {
    const ws = new InMemoryWorkspaceRepository();
    const rt = new ToolRuntime();
    for (const t of makeWorkspaceTools(ws, { ownerId: 'u' })) rt.register(t);
    const r = await rt.invoke('fs_write', { path: '../escape.md', content: 'x' });
    expect(r.ok).toBe(false);
    expect(await ws.list('u')).toHaveLength(0);
  });
});
