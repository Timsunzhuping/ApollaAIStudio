import { describe, expect, it } from 'vitest';
import { crc32, markdownToDocx, markdownToDocumentXml } from './docx';
import { exportArtifact } from './export';

const MD = [
  '# 固态电池研究',
  '',
  'Battery prices fell **below $90** in 2025. [^sn-1]',
  '',
  '## Key claims',
  '- **[Corroborated]** Growth continued (…)',
  '',
  '## Sources',
  '- [fake:1] EV report — https://a.test',
].join('\n');

describe('markdownToDocumentXml', () => {
  const xml = markdownToDocumentXml(MD);

  it('renders headings, bullets, bold runs, and preserves citations as text', () => {
    expect(xml).toContain('固态电池研究');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('below $90');
    expect(xml).toContain('[^sn-1]');
    expect(xml).toContain('•  ');
  });

  it('escapes XML-hostile characters', () => {
    const hostile = markdownToDocumentXml('a < b & c > "d"');
    expect(hostile).toContain('a &lt; b &amp; c &gt; &quot;d&quot;');
    expect(hostile).not.toContain('a < b');
  });
});

describe('markdownToDocx (zip integrity)', () => {
  const bytes = markdownToDocx(MD);

  it('starts with the local-file signature and ends with a valid EOCD', () => {
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\3\4
    const eocd = bytes.slice(bytes.length - 22);
    expect([...eocd.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]); // PK\5\6
    // entry count = 3 (content types, rels, document)
    expect(eocd[10]! | (eocd[11]! << 8)).toBe(3);
  });

  it('contains the three OOXML parts', () => {
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('_rels/.rels');
    expect(text).toContain('word/document.xml');
    expect(text).toContain('officeDocument');
  });

  it('crc32 matches a known vector', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });
});

describe('exportArtifact docx', () => {
  it('returns binary content with the Word mime and .docx filename', () => {
    const f = exportArtifact({ id: 'r1', type: 'report', format: 'markdown', content: MD }, 'docx');
    expect(f.filename).toBe('r1.docx');
    expect(f.mime).toContain('wordprocessingml');
    expect(f.content).toBeInstanceOf(Uint8Array);
  });
});
