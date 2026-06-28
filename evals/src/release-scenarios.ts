import { validateConfig } from '@apolla/bff/config';
import type { CheckResult } from './checks';

/**
 * Release readiness (S24): production config validation is FAIL-CLOSED — an insecure production
 * configuration produces errors (so the process refuses to boot) while a complete one is clean, and
 * dev/offline stays zero-config (no errors). Fully offline (pure function over an env object).
 */
export async function releaseReadiness(): Promise<CheckResult> {
  const issues: string[] = [];

  // Production without a real session secret must error (never boot with the dev default key).
  if (validateConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }).errors.length === 0) {
    issues.push('production with no SESSION_SECRET did not error');
  }
  // Production without durable storage must error.
  if (validateConfig({ NODE_ENV: 'production', SESSION_SECRET: 'strong' }).errors.length === 0) {
    issues.push('production with no DATABASE_URL did not error');
  }
  // A fully-configured production env is clean.
  if (validateConfig({ NODE_ENV: 'production', SESSION_SECRET: 'strong', DATABASE_URL: 'postgres://x' }).errors.length !== 0) {
    issues.push('a complete production config still reported errors');
  }
  // Dev / offline is zero-config: warnings only, never errors.
  const dev = validateConfig({});
  if (dev.errors.length !== 0) issues.push('dev config reported errors (should be zero-config)');
  if (dev.warnings.length === 0) issues.push('dev config produced no warnings');

  return { name: 'release-readiness', ok: issues.length === 0, issues };
}

export async function runReleaseScenarios(): Promise<CheckResult[]> {
  return [await releaseReadiness()];
}
