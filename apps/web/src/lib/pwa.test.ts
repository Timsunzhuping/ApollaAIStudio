import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerPWA } from './pwa';

describe('PWA (S36/B6)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers the service worker only in production builds', () => {
    const register = vi.fn(async () => ({}));
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    // dev/test → never registers (a worker would cache Vite dev modules)
    expect(registerPWA({ prod: false })).toBe(false);
    // prod + support → registers on window load
    expect(registerPWA({ prod: true })).toBe(true);
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('is a no-op without serviceWorker support (progressive)', () => {
    vi.stubGlobal('navigator', {});
    expect(registerPWA({ prod: true })).toBe(false);
  });

  it('ships a valid manifest: installable fields + icons + standalone display', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../public/manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
    expect(manifest.name).toBe('Apolla AI Studio');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    const icons = manifest.icons as { src: string; purpose: string }[];
    expect(icons.length).toBeGreaterThanOrEqual(2);
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('the service worker never caches /api or /media (data must stay live)', () => {
    const sw = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8');
    expect(sw).toContain("startsWith('/api/')");
    expect(sw).toContain("startsWith('/media/')");
    expect(sw).toContain('data is never cached');
  });
});
