import type { RouteConfig } from '@apolla/contracts';

/** Default env-var names per provider. Route.keyPool extends these for rotation. */
const PROVIDER_ENV_DEFAULTS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
};

export interface ApiKey {
  name: string;
  value: string;
}

/** Env-var names to try for a provider: provider defaults + the route's keyPool, de-duped. */
export function resolveKeyNames(provider: string, route: RouteConfig): string[] {
  const names = new Set<string>([...(PROVIDER_ENV_DEFAULTS[provider] ?? []), ...route.keyPool]);
  return [...names];
}

/**
 * Resolve usable API keys for a provider from the environment, in declared order.
 * Keys are resolved by PROVIDER (not blindly from the route) so a cross-provider fallback
 * never receives the wrong provider's key.
 */
export function resolveKeyPairs(
  provider: string,
  route: RouteConfig,
  env: NodeJS.ProcessEnv,
): ApiKey[] {
  const pairs: ApiKey[] = [];
  for (const name of resolveKeyNames(provider, route)) {
    const value = env[name];
    if (value) pairs.push({ name, value });
  }
  return pairs;
}
