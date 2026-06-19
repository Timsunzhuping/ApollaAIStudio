import { describe, it, expect } from 'vitest';
import type { Artifact } from '@apolla/contracts';
import { exportArtifact } from './export';

const artifact: Artifact = {
  id: 'report-1',
  type: 'report',
  format: 'markdown',
  content: [
    '# EV market 2026',
    '',
    'EV sales rose in 2026 [stub:1].',
    '',
    '## Sources',
    '',
    '- [stub:1] EV report — https://a.test/ev/1',
  ].join('\n'),
};

describe('exportArtifact', () => {
  it('returns markdown verbatim', () => {
    const f = exportArtifact(artifact, 'markdown');
    expect(f.filename).toBe('report-1.md');
    expect(f.mime).toBe('text/markdown');
    expect(f.content).toContain('[stub:1]');
  });

  it('renders HTML with headings, list, and a linked source', () => {
    const f = exportArtifact(artifact, 'html');
    expect(f.filename).toBe('report-1.html');
    expect(f.mime).toBe('text/html');
    expect(f.content).toContain('<h1>EV market 2026</h1>');
    expect(f.content).toContain('<h2>Sources</h2>');
    expect(f.content).toContain('<li>');
    expect(f.content).toContain('<a href="https://a.test/ev/1">');
    // citation marker preserved
    expect(f.content).toContain('[stub:1]');
  });

  it('escapes HTML to prevent injection from report content', () => {
    const evil: Artifact = {
      id: 'x',
      type: 'report',
      format: 'markdown',
      content: 'Hello <script>alert(1)</script>',
    };
    const html = exportArtifact(evil, 'html').content;
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
