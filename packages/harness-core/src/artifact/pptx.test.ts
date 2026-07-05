import { describe, expect, it } from 'vitest';
import { markdownToPptx, planSlides } from './pptx';
import { exportArtifact } from './export';

const MD = [
  '# 固态电池研究',
  '',
  '这是概述段落。',
  '',
  '## Key claims',
  '- **[Corroborated]** Growth continued [^sn-1]',
  '- normal bullet',
  '',
  '## Sources',
  '- [fake:1] EV report',
].join('\n');

describe('planSlides', () => {
  it('splits title + ## sections into slides, strips bold, keeps citations as text', () => {
    const slides = planSlides(MD);
    expect(slides.map((s) => s.title)).toEqual(['固态电池研究', 'Key claims', 'Sources']);
    expect(slides[0]!.lines[0]!.text).toBe('这是概述段落。');
    expect(slides[1]!.lines[0]!).toEqual({ text: '[Corroborated] Growth continued [^sn-1]', bullet: true });
  });

  it('overflows long sections into continuation slides', () => {
    const long = ['## Long', ...Array.from({ length: 20 }, (_, i) => `- point ${i}`)].join('\n');
    const slides = planSlides(long);
    expect(slides.length).toBe(3); // 8 + 8 + 4
    expect(slides[1]!.title).toBe('Long（续）');
  });
});

describe('markdownToPptx (zip + package integrity)', () => {
  const bytes = markdownToPptx(MD);
  const text = new TextDecoder('latin1').decode(bytes);

  it('is a valid zip with the canonical presentation parts', () => {
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...bytes.slice(bytes.length - 22, bytes.length - 18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    for (const part of [
      '[Content_Types].xml',
      'ppt/presentation.xml',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
      'ppt/slides/slide1.xml',
      'ppt/slides/slide3.xml',
      'ppt/slides/_rels/slide1.xml.rels',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('escapes XML-hostile characters in slide text', () => {
    const hostile = new TextDecoder().decode(markdownToPptx('# a < b & "c"'));
    expect(hostile).toContain('a &lt; b &amp; &quot;c&quot;');
  });
});

describe('exportArtifact pptx', () => {
  it('returns binary content with the PowerPoint mime and .pptx filename', () => {
    const f = exportArtifact({ id: 'r1', type: 'report', format: 'markdown', content: MD }, 'pptx');
    expect(f.filename).toBe('r1.pptx');
    expect(f.mime).toContain('presentationml');
    expect(f.content).toBeInstanceOf(Uint8Array);
  });
});
