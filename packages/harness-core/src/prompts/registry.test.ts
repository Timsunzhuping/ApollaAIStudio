import { describe, it, expect } from 'vitest';
import type { PromptVersion } from '@apolla/contracts';
import { PromptRegistry } from './registry';

function p(over: Partial<PromptVersion> & Pick<PromptVersion, 'promptId' | 'version'>): PromptVersion {
  return {
    scene: 'test',
    template: 'hello',
    safetyConstraints: [],
    rollout: 1,
    ...over,
  };
}

describe('PromptRegistry', () => {
  it('returns the newest active version by default', () => {
    const reg = new PromptRegistry([
      p({ promptId: 'greet', version: '1', template: 'v1' }),
      p({ promptId: 'greet', version: '2', template: 'v2' }),
    ]);
    expect(reg.get('greet').version).toBe('2');
  });

  it('honors an explicit version pin', () => {
    const reg = new PromptRegistry([
      p({ promptId: 'greet', version: '1' }),
      p({ promptId: 'greet', version: '2' }),
    ]);
    expect(reg.get('greet', { pin: '1' }).version).toBe('1');
  });

  it('throws on unknown id or version', () => {
    const reg = new PromptRegistry([p({ promptId: 'greet', version: '1' })]);
    expect(() => reg.get('nope')).toThrow();
    expect(() => reg.get('greet', { pin: '9' })).toThrow();
  });

  it('does canary rollout: serves the newest version only to the covered fraction', () => {
    const reg = new PromptRegistry([
      p({ promptId: 'greet', version: '1', template: 'stable', rollout: 1 }),
      p({ promptId: 'greet', version: '2', template: 'canary', rollout: 0.3 }),
    ]);
    // rand below the canary's rollout → newest (canary)
    expect(reg.get('greet', { rand: () => 0.1 }).version).toBe('2');
    // rand above the canary's rollout → falls through to stable
    expect(reg.get('greet', { rand: () => 0.5 }).version).toBe('1');
  });

  it('skips fully-disabled versions (rollout 0)', () => {
    const reg = new PromptRegistry([
      p({ promptId: 'greet', version: '1', template: 'on', rollout: 1 }),
      p({ promptId: 'greet', version: '2', template: 'off', rollout: 0 }),
    ]);
    expect(reg.get('greet').version).toBe('1');
  });

  it('renders {{var}} placeholders and returns the resolved prompt', () => {
    const reg = new PromptRegistry([
      p({ promptId: 'greet', version: '1', template: 'Hello {{name}}, re: {{topic}}' }),
    ]);
    const r = reg.render('greet', { name: 'Tim', topic: 'EVs' });
    expect(r.text).toBe('Hello Tim, re: EVs');
    expect(r.prompt.promptId).toBe('greet');
  });

  it('throws when a required variable is missing', () => {
    const reg = new PromptRegistry([p({ promptId: 'greet', version: '1', template: 'Hi {{name}}' })]);
    expect(() => reg.render('greet', {})).toThrow(/Missing variable/);
  });

  it('loads from @apolla/config without error (empty until T10 authors prompts)', () => {
    expect(() => new PromptRegistry()).not.toThrow();
  });
});
