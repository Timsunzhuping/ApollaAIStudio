import { describe, it, expect } from 'vitest';
import { loadRoutes, getRoute, loadFeatureGates, loadPrompts, loadSkills } from './index';
import { parseFrontmatter } from './frontmatter';

describe('routes registry', () => {
  it('loads all four required aliases', () => {
    const routes = loadRoutes();
    const aliases = routes.map((r) => r.alias).sort();
    expect(aliases).toEqual(['claude_premium', 'claude_write', 'gpt_fast', 'gpt_premium']);
  });

  it('every route has a non-empty primary model id', () => {
    for (const r of loadRoutes()) expect(r.primary.length).toBeGreaterThan(0);
  });

  it('resolves a route by alias', () => {
    expect(getRoute('claude_write').alias).toBe('claude_write');
  });
});

describe('feature gates registry', () => {
  it('parses gates with capability requirements', () => {
    const gates = loadFeatureGates();
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.find((g) => g.feature === 'auto_skill_write')).toBeTruthy();
  });
});

describe('prompt/skill loaders', () => {
  it('return empty arrays before T5/T10 author files', () => {
    expect(loadPrompts()).toEqual([]);
    expect(loadSkills()).toEqual([]);
  });
});

describe('frontmatter parser', () => {
  it('parses scalars and inline arrays', () => {
    const { data, body } = parseFrontmatter(
      ['---', 'name: research', 'tools: [search, parse]', 'rollout: 1', '---', 'Body here'].join(
        '\n',
      ),
    );
    expect(data.name).toBe('research');
    expect(data.tools).toEqual(['search', 'parse']);
    expect(data.rollout).toBe(1);
    expect(body.trim()).toBe('Body here');
  });
});
