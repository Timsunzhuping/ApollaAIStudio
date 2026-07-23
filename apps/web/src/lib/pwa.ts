/**
 * PWA service-worker registration (S36/B6). Production builds only: in dev/tests a worker would
 * cache Vite's dev modules and poison hot reload, so registration is gated on both PROD and browser
 * support. Failure is silent — the app works identically without a worker; the PWA is progressive.
 */
export function registerPWA(env: { prod: boolean } = { prod: import.meta.env.PROD }): boolean {
  if (!env.prod) return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
  return true;
}
