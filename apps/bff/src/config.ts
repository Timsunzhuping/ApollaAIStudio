import { DEV_SESSION_SECRET } from './auth';
import { loadRoutes } from '@apolla/config';

/**
 * Startup configuration validation (S24). In production we FAIL FAST on insecure config (a missing or
 * default SESSION_SECRET would silently sign sessions with a public key) rather than booting unsafe.
 * Warnings never block — they just surface degraded/dev-only modes. Pure function for offline tests.
 */
export function validateConfig(env: NodeJS.ProcessEnv = process.env): { errors: string[]; warnings: string[] } {
  // Password mode (or NODE_ENV=production) means real cookie auth — the session secret must be real.
  const authStrict = env.NODE_ENV === 'production' || env.AUTH_MODE === 'password';
  // Only TRUE production demands durable storage; password mode alone (e.g. hermetic e2e) may be in-memory.
  const strictProd = env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  if (authStrict && (!env.SESSION_SECRET || env.SESSION_SECRET === DEV_SESSION_SECRET)) {
    errors.push('SESSION_SECRET must be set to a strong, unique value in production — it signs session cookies. Refusing to start with the dev default.');
  }
  if (strictProd && !env.DATABASE_URL) {
    errors.push('DATABASE_URL must be set in production — the in-memory store is not durable.');
  }
  if (!strictProd && !env.DATABASE_URL) {
    warnings.push('DATABASE_URL is unset — using the in-memory store (not durable; dev/e2e only).');
  }

  if (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY) warnings.push('No LLM API key (OPENAI_API_KEY / ANTHROPIC_API_KEY) — running the deterministic stub model.');
  // Real mode with placeholder routes would 403/404 on every model call at runtime (first
  // production deploy hit exactly this). Fail fast with the fix instead of booting broken.
  if (env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY) {
    try {
      if (routesHavePlaceholders()) {
        errors.push(
          'Model routes still contain *-PLACEHOLDER ids while an LLM key is set — every model call would fail. ' +
            'Point APOLLA_ROUTES_FILE at a routes file with real model ids (see deploy runbook / routes.override.json), ' +
            'or unset the LLM keys to run the offline stub.',
        );
      }
    } catch (e) {
      errors.push(`Model routes failed to load: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!env.ADMIN_EMAILS) warnings.push('ADMIN_EMAILS is unset — the operator console has no admins.');
  if (!env.REDIS_URL) warnings.push('REDIS_URL is unset — jobs run in-process (no distributed worker).');

  return { errors, warnings };
}

/** Validate at boot; print findings; exit(1) on any error. Called from the server/worker entrypoints. */
export function enforceConfigOrExit(label: string, env: NodeJS.ProcessEnv = process.env): void {
  const { errors, warnings } = validateConfig(env);
  for (const w of warnings) console.warn(`[${label}] config warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[${label}] config error: ${e}`);
    console.error(`[${label}] refusing to start with ${errors.length} configuration error(s).`);
    process.exit(1);
  }
}

/** True when the effective alias→model mapping still contains provisioning placeholders. */
export function routesHavePlaceholders(): boolean {
  return loadRoutes().some((r) => r.primary.includes('PLACEHOLDER') || r.fallbackChain.some((m) => m.includes('PLACEHOLDER')));
}
