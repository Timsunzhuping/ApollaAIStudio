/**
 * Minimal, dependency-free Markdown → DOCX (S28 / PRD §6.6). A .docx is a zip of OOXML parts;
 * we emit the smallest valid package (content types, package rels, document) with STORE-method
 * zip entries, covering our report structure: headings, bullets, bold, plain paragraphs.
 * Citations ([^id], [source:1]) and the source list are preserved as text.
 */

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

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ── Minimal ZIP writer (method 0 = stored) ────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  for (const f of files) {
    const name = utf8(f.name);
    const crc = crc32(f.data);
    const local = cat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0),
      name, f.data,
    );
    central.push(
      cat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name,
      ),
    );
    chunks.push(local);
    offset += local.length;
  }

  const centralAll = cat(...central);
  const eocd = cat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralAll.length), u32(offset), u16(0),
  );
  return cat(...chunks, centralAll, eocd);
}
