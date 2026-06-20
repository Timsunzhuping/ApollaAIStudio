import { describe, it, expect } from 'vitest';
import type { ModelAlias, RouteConfig, AuditEntry } from '@apolla/contracts';
import { AgentOrchestrator } from './orchestrator';
import { ModelRouter } from '../router/router';
import { MockAdapter } from '../router/mock';
import { PromptRegistry } from '../prompts/registry';
import { ToolRuntime } from '../tools/runtime';
import { StubMCPClient } from '../tools/mcp-stub';

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

describe('agent audit log', () => {
  it('records every tool call with its verdict and confirmation outcome', async () => {
    const tools = new ToolRuntime();
    await tools.connectMCP(new StubMCPClient(), { name: 'demo', transport: 'stub', readOnlyTools: ['echo'] });
    const audited: AuditEntry[] = [];
    const router = decisions([
      { action: 'call_tool', tool: 'demo/echo', args: { text: 'a' } }, // read → allow/executed
      { action: 'call_tool', tool: 'demo/save_note', args: { text: 'b' } }, // low_write → confirm denied
      { action: 'call_tool', tool: 'demo/save_note', args: { text: 'c' } }, // low_write → confirm approved
      { action: 'finish', answer: 'done' },
    ]);
    let approveCount = 0;
    const agent = new AgentOrchestrator({
      router,
      tools,
      prompts,
      audit: (e) => {
        audited.push(e);
      },
    });
    // deny the first save, approve the second
    const approve = async () => approveCount++ === 1;
    for await (const _e of agent.run({ ownerId: 'u', goal: 'do things', taskId: 't1', approve })) void _e;

    // three tool attempts → three audit entries
    expect(audited).toHaveLength(3);
    expect(audited[0]).toMatchObject({ tool: 'demo/echo', decision: 'allow', status: 'executed' });
    expect(audited[1]).toMatchObject({ tool: 'demo/save_note', decision: 'confirm', confirmed: false, status: 'denied' });
    expect(audited[2]).toMatchObject({ tool: 'demo/save_note', decision: 'confirm', confirmed: true, status: 'executed' });
    expect(audited.every((e) => e.ownerId === 'u' && e.taskId === 't1')).toBe(true);
  });
});
