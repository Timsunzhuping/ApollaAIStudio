import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { capturePageContext } from './content';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('extension security (S12-T6)', () => {
  it('manifest is least-privilege (no <all_urls>, host_permissions scoped, no broad content scripts)', () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    expect(manifest.permissions).not.toContain('<all_urls>');
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest).not.toHaveProperty('content_scripts'); // injected on demand via scripting
    for (const h of manifest.host_permissions as string[]) expect(h).not.toBe('<all_urls>');
  });

  it('page capture returns only selection/title/url — never reads storage/tokens', () => {
    const src = read('src/content.ts');
    expect(src).not.toMatch(/chrome\.storage|apiToken|Authorization|Bearer/);
    const ctx = capturePageContext();
    expect(Object.keys(ctx).sort()).toEqual(['selection', 'title', 'url']);
  });
});
