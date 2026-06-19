/**
 * Minimal YAML-frontmatter parser (no deps) for declarative Prompt/Skill Markdown.
 * Supports scalar values, `key: [a, b, c]` inline arrays, and quoted strings.
 * Sprint 01 T5/T10 may replace this with gray-matter if richer YAML is needed.
 */
export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

function coerce(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => coerce(s));
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseFrontmatter(src: string): Frontmatter {
  if (!src.startsWith('---')) return { data: {}, body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: src };

  const header = src.slice(3, end).trim();
  const body = src.slice(end + 4).replace(/^\r?\n/, '');

  const data: Record<string, unknown> = {};
  for (const line of header.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    if (key) data[key] = coerce(value);
  }
  return { data, body };
}
