/**
 * Minimal, dependency-free Markdown → DOCX (S28 / PRD §6.6). A .docx is a zip of OOXML parts;
 * we emit the smallest valid package (content types, package rels, document) with STORE-method
 * zip entries, covering our report structure: headings, bullets, bold, plain paragraphs.
 * Citations ([^id], [source:1]) and the source list are preserved as text.
 */

import { zipStore, crc32, utf8 } from './zip';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline markdown → runs: bold (**x**) becomes a bold run; everything else literal text. */
function runs(text: string, extra = ''): string {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  return parts
    .map((p) => {
      const m = /^\*\*([^*]+)\*\*$/.exec(p);
      const bold = m ? '<w:b/>' : '';
      const t = m ? m[1]! : p;
      return `<w:r><w:rPr>${extra}${bold}</w:rPr><w:t xml:space="preserve">${escXml(t)}</w:t></w:r>`;
    })
    .join('');
}

function para(inner: string, props = ''): string {
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
}

/** Markdown → word/document.xml body. */
export function markdownToDocumentXml(md: string): string {
  const body: string[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) {
      body.push(para(runs(line.slice(2), '<w:sz w:val="36"/>'), '<w:spacing w:after="240"/>'));
    } else if (line.startsWith('## ')) {
      body.push(para(runs(`**${line.slice(3)}**`, '<w:sz w:val="28"/>'), '<w:spacing w:before="240" w:after="120"/>'));
    } else if (line.startsWith('- ')) {
      body.push(para(runs(`•  ${line.slice(2)}`), '<w:ind w:left="360"/>'));
    } else if (line.trim() === '') {
      // blank line → paragraph spacing is handled by the following block
    } else {
      body.push(para(runs(line)));
    }
  }
  return `${XML_HEAD}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('')}<w:sectPr/></w:body>
</w:document>`;
}

const CONTENT_TYPES = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const PACKAGE_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Markdown → complete .docx bytes. */
export function markdownToDocx(md: string): Uint8Array {
  return zipStore([
    { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
    { name: '_rels/.rels', data: utf8(PACKAGE_RELS) },
    { name: 'word/document.xml', data: utf8(markdownToDocumentXml(md)) },
  ]);
}


export { crc32 } from './zip';
