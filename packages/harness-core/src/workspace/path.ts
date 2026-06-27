/**
 * Normalize a workspace-relative path and REJECT anything that could escape the owner/project
 * scope (path traversal is the #1 risk for a file workspace — S7-T6). Returns a clean,
 * scope-relative path ("a/b.md") or throws. Enforced at BOTH the tool layer and the repo layer.
 */
export class PathError extends Error {}

const BACKSLASH = String.fromCharCode(92);

/** True if the string contains a control char (0x00–0x1F) or a backslash. */
function hasIllegalChar(s: string): boolean {
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || ch === BACKSLASH) return true;
  }
  return false;
}

export function normalizeWorkspacePath(raw: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') throw new PathError('empty path');
  if (hasIllegalChar(raw)) throw new PathError('illegal characters in path');
  if (raw.startsWith('/')) throw new PathError('absolute paths are not allowed');
  const segments: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue; // collapse empties and "."
    if (seg === '..') throw new PathError('path traversal ("..") is not allowed');
    segments.push(seg);
  }
  if (segments.length === 0) throw new PathError('path resolves to empty');
  return segments.join('/');
}
