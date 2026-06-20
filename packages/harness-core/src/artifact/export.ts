import type { Artifact } from '@apolla/contracts';

export type ExportFormat = 'markdown' | 'html';

export interface ExportedFile {
  filename: string;
  mime: string;
  content: string;
}

function slug(artifact: Artifact): string {
  return (artifact.id || 'report').replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline markdown: images ![alt](url), links [text](url), bare URLs. Citations [fake:1] stay text. */
function inline(s: string): string {
  return s
    .replace(
      /!\[([^\]]*)\]\((https?:[^)]+|data:[^)]+)\)/g,
      (_m, alt, u) => `<img src="${u}" alt="${alt}" style="max-width:100%;border-radius:8px" />`,
    )
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_m, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/(^|[^"=>])(https?:\/\/[^\s<]+)/g, (_m, p, u) => `${p}<a href="${u}">${u}</a>`);
}

/** Append generated media (images inline, videos as poster + link) to a report's Markdown. */
export function embedMedia(markdown: string, assets: import('@apolla/contracts').MediaAsset[]): string {
  const blocks = assets.map((a) =>
    a.kind === 'image'
      ? `\n\n![generated image](${a.uri})`
      : `\n\n${a.posterUri ? `![poster](${a.posterUri})\n\n` : ''}[▶ watch video](${a.uri})`,
  );
  return markdown + blocks.join('');
}

/** Minimal, dependency-free Markdown → HTML for our report structure (headings, lists, paragraphs). */
function renderHtml(md: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      closeList();
      out.push(`<h2>${inline(esc(line.slice(3)))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      out.push(`<h1>${inline(esc(line.slice(2)))}</h1>`);
    } else if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(esc(line.slice(2)))}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(esc(line))}</p>`);
    }
  }
  closeList();
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Apolla report</title>',
    '<style>body{max-width:48rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif}h1{font-size:1.6rem}h2{font-size:1.2rem;margin-top:2rem}a{color:#2563eb}</style>',
    '</head><body><article>',
    out.join('\n'),
    '</article></body></html>',
    '',
  ].join('\n');
}

/** Export an Artifact to a downloadable file. Citations and source list are preserved verbatim. */
export function exportArtifact(artifact: Artifact, fmt: ExportFormat): ExportedFile {
  const md = artifact.content ?? '';
  if (fmt === 'markdown') {
    return { filename: `${slug(artifact)}.md`, mime: 'text/markdown', content: md };
  }
  return { filename: `${slug(artifact)}.html`, mime: 'text/html', content: renderHtml(md) };
}
