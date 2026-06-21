import { describe, it, expect } from 'vitest';
import type { Plugin } from '@apolla/contracts';
import {
  InMemoryPluginRepository,
  InMemorySkillRepository,
  CompositeSkillSource,
} from '../repo/memory';

const researchAnalyst: Plugin = {
  name: 'research-analyst',
  description: 'briefs',
  skills: [
    {
      name: 'competitive-brief',
      triggers: ['brief'],
      tools: ['web_search'],
      io: {},
      risk: 'read',
      promptRef: 'research.synthesize',
      executor: 'research',
    },
  ],
  requiredConnectors: [],
  commands: [{ alias: '/brief', skill: 'competitive-brief' }],
};

describe('PluginRepository + plugin skills', () => {
  it('install makes plugin skills appear in the SkillSource, scoped per owner', async () => {
    const plugins = new InMemoryPluginRepository();
    const userSkills = new InMemorySkillRepository();
    const source = new CompositeSkillSource([], userSkills, plugins);

    expect(await source.list('u')).toHaveLength(0);

    await plugins.install('u', researchAnalyst);
    const skills = await source.list('u');
    expect(skills.map((s) => s.name)).toContain('competitive-brief');

    // owner isolation: another user does not see it
    expect(await source.list('other')).toHaveLength(0);

    // installed list reflects the plugin
    expect((await plugins.list('u')).map((p) => p.name)).toEqual(['research-analyst']);
  });

  it('uninstall removes the plugin and its skills', async () => {
    const plugins = new InMemoryPluginRepository();
    const source = new CompositeSkillSource([], new InMemorySkillRepository(), plugins);
    await plugins.install('u', researchAnalyst);
    await plugins.uninstall('u', 'research-analyst');
    expect(await plugins.list('u')).toHaveLength(0);
    expect(await source.list('u')).toHaveLength(0);
  });

  it('skillsFor flattens skills from all installed plugins', async () => {
    const plugins = new InMemoryPluginRepository();
    await plugins.install('u', researchAnalyst);
    await plugins.install('u', { ...researchAnalyst, name: 'p2', skills: [{ ...researchAnalyst.skills[0]!, name: 's2' }] });
    expect((await plugins.skillsFor('u')).map((s) => s.name).sort()).toEqual(['competitive-brief', 's2']);
  });
});
