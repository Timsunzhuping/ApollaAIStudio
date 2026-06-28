import { describe, it, expect } from 'vitest';
import { planAction } from './actions';

const ctx = (selection: string, title = 'A Page', url = 'https://x') => ({ selection, title, url });

describe('planAction', () => {
  it('research uses the selection as the question', () => {
    expect(planAction('research', ctx('EV market 2026'))).toEqual({ kind: 'research', question: 'EV market 2026', label: 'Research' });
  });
  it('translate → translate-text surface with the selection', () => {
    const p = planAction('translate', ctx('bonjour'));
    expect(p).toMatchObject({ kind: 'surface', surfaceId: 'translate-text', text: 'bonjour' });
  });
  it('summarize → summarize surface; falls back to the title when no selection', () => {
    const p = planAction('summarize', ctx('', 'My Article'));
    expect(p).toMatchObject({ kind: 'surface', surfaceId: 'summarize', text: 'My Article' });
  });
});
