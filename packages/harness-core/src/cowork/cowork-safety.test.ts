import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, ToolResult, AuditEntry } from '@apolla/contracts';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { StubMCPClient } from '../tools/mcp-stub';
import type { Tool } from '../tools/types';
import { AgentOrchestrator } from '../agent/orchestrator';
import { Coordinator, type CoworkEvent } from './coordinator';

const prompts = new PromptRegistry([
  { promptId: 'agent.step', version: '1', scene: 'a', template: 'Decide.', safetyConstraints: [], rollout: 1 },
  { promptId: 'cowork.synthesize', version: '1', scene: 's', template: 'Synthesize.', safetyConstraints: [], rollout: 1 },
]);

function router(behavior: { jsonSequence?: string[]; streamText?: string }): ModelRouter {
  return new ModelRouter({
    adapters: new Map([['m', new MockAdapter('m', behavior)]]),
    env: { K: 'k' },
    routeFor: (a: ModelAlias): RouteConfig => ({ a, primary: 'm/x', fallbackChain: [], keyPool: ['K'] }) as never,
  });
}

async function drain(it: AsyncIterable<CoworkEvent>): Promise<void> {
  for await (const _e of it) void _e;
}

describe('Cowork safety inheritance (S6-T7)', () => {
  it('sub-agents deny high_write even when approve permits — inherits Safety tiers', async () => {
    const tools = new ToolRuntime();
    await tools.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
    const danger: Tool = { name: 'danger/delete_all', risk: 'high_write', source: 'native', schema: {}, async invoke(): Promise<ToolResult> { return { ok: true, data: [] }; } };
    tools.register(danger);
    const r = router({
      jsonSequence: ['{"action":"call_tool","tool":"danger/delete_all","args":{}}', '{"action":"finish","answer":"x"}'],
      streamText: 'BRIEF',
    });
    const audited: AuditEntry[] = [];
    const agent = new AgentOrchestrator({ router: r, tools, prompts, audit: (e) => { audited.push(e); } });
    const coord = new Coordinator({ agent, router: r, prompts });
    await drain(coord.run({ ownerId: 'u', goal: 'g', subgoals: ['be dangerous'], taskId: 't', approve: async () => true }));
    expect(audited.some((e) => e.tool === 'danger/delete_all' && e.status === 'denied')).toBe(true);
    expect(audited.some((e) => e.tool === 'danger/delete_all' && e.status === 'executed')).toBe(false);
  });

  it('sub-agent low_write runs only when the (allowlist) approve permits it', async () => {
    const run = async (approve: (c: { tool: string }) => Promise<boolean>): Promise<AuditEntry[]> => {
      const tools = new ToolRuntime();
      await tools.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
      const r = router({
        jsonSequence: ['{"action":"call_tool","tool":"demo/save_note","args":{"text":"x"}}', '{"action":"finish","answer":"x"}'],
        streamText: 'B',
      });
      const audited: AuditEntry[] = [];
      const agent = new AgentOrchestrator({ router: r, tools, prompts, audit: (e) => { audited.push(e); } });
      const coord = new Coordinator({ agent, router: r, prompts });
      await drain(coord.run({ ownerId: 'u', goal: 'g', subgoals: ['save a note'], taskId: 't', approve }));
      return audited;
    };
    const allow = new Set<string>();
    const denied = await run(async (c) => allow.has(c.tool)); // empty allowlist → background default
    expect(denied.some((e) => e.tool === 'demo/save_note' && e.status === 'executed')).toBe(false);
    const allowed = await run(async (c) => new Set(['demo/save_note']).has(c.tool));
    expect(allowed.some((e) => e.tool === 'demo/save_note' && e.status === 'executed')).toBe(true);
  });
});
