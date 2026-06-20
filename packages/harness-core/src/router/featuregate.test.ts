import { describe, it, expect } from 'vitest';
import type { ModelCaps, FeatureGate, ModelAlias, RouteConfig } from '@apolla/contracts';
import { FeatureGates } from './featuregate';
import { probeStructuredReliability } from './probes';
import { ModelRouter } from './router';
import { MockAdapter } from './mock';

const CAPS = (over: Partial<ModelCaps> = {}): ModelCaps => ({
  toolUse: true,
  parallelToolUse: false,
  longContext: 128000,
  vision: false,
  reasoningDepth: 2,
  structuredReliability: 0.9,
  agenticReliability: 0.8,
  ...over,
});

const gates: FeatureGate[] = [
  { feature: 'auto_skill_write', requires: { agenticReliability: 0.7 }, scaffold: null },
  { feature: 'multi_tool_plan', requires: { toolUse: true, agenticReliability: 0.6 } },
  { feature: 'a2ui', requires: { structuredReliability: 0.8 }, scaffold: 'static_artifact' },
];

describe('FeatureGates', () => {
  it('enables features when caps meet the requirement', () => {
    const fg = new FeatureGates(gates, CAPS());
    expect(fg.enabled('auto_skill_write')).toBe(true);
    expect(fg.enabled('a2ui')).toBe(true);
  });

  it('disables and offers a scaffold when caps fall short — and re-enables when caps improve', () => {
    const fg = new FeatureGates(gates, CAPS({ structuredReliability: 0.5, agenticReliability: 0.5 }));
    expect(fg.enabled('auto_skill_write')).toBe(false);
    expect(fg.enabled('a2ui')).toBe(false);
    expect(fg.scaffoldFor('a2ui')).toBe('static_artifact');
    // model upgrade → probes recalibrate caps → feature turns on, scaffold retires
    fg.setCaps(CAPS());
    expect(fg.enabled('a2ui')).toBe(true);
    expect(fg.scaffoldFor('a2ui')).toBeNull();
  });

  it('unknown feature is disabled', () => {
    expect(new FeatureGates(gates, CAPS()).enabled('nope')).toBe(false);
  });
});

describe('probeStructuredReliability', () => {
  const route = (alias: ModelAlias): RouteConfig => ({ alias, primary: 'm/x', fallbackChain: [], keyPool: ['K'] });

  it('returns 1 when the model emits valid structured output', async () => {
    const router = new ModelRouter({
      adapters: new Map([['m', new MockAdapter('m', { text: '{"ok": true}' })]]),
      env: { K: 'k' },
      routeFor: route,
    });
    expect(await probeStructuredReliability(router, 'gpt_fast')).toBe(1);
  });

  it('returns 0 when the model cannot', async () => {
    const router = new ModelRouter({
      adapters: new Map([['m', new MockAdapter('m', { text: 'not json' })]]),
      env: { K: 'k' },
      routeFor: route,
      jsonMaxRetries: 0,
    });
    expect(await probeStructuredReliability(router, 'gpt_fast')).toBe(0);
  });
});
