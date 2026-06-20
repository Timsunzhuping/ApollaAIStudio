import { describe, it, expect } from 'vitest';
import { loadRoutes, getRoute, loadFeatureGates, loadPrompts, loadSkills, loadMediaRoutes, getMediaRoute } from './index';
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

describe('media routes registry', () => {
  it('loads all four required media aliases', () => {
    const aliases = loadMediaRoutes().map((r) => r.alias).sort();
    expect(aliases).toEqual(['image_fast', 'image_premium', 'video_premium', 'video_standard']);
  });

  it('resolves a media route by alias with a primary provider id', () => {
    expect(getMediaRoute('video_premium').primary.length).toBeGreaterThan(0);
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
  it('load the authored research prompts', () => {
    const ids = loadPrompts().map((p) => p.promptId);
    expect(ids).toContain('research.plan');
    expect(ids).toContain('research.synthesize');
  });

  it('parse PromptVersion fields from frontmatter', () => {
    const plan = loadPrompts().find((p) => p.promptId === 'research.plan');
    expect(plan?.version).toBe('1');
    expect(plan?.rollout).toBe(1);
    expect(plan?.safetyConstraints).toContain('no-fabrication');
    expect(plan?.template).toContain('decompose');
  });

  it('load the research skill', () => {
    const skills = loadSkills();
    const research = skills.find((s) => s.name === 'research');
    expect(research?.tools).toContain('web_search');
    expect(research?.risk).toBe('read');
    expect(research?.promptRef).toBe('research.synthesize');
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
