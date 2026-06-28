/**
 * Single source of truth for the app version (S24). The package.json versions are aligned to this for
 * release tooling, but at runtime everything reads VERSION here. Overridable by env for CI builds.
 */
export const VERSION = process.env.APP_VERSION ?? '1.0.0';
export const COMMIT = process.env.GIT_SHA ?? undefined;

/** Public build info — version + commit only. Never includes secrets, connection strings, or hosts. */
export function versionInfo(): { version: string; commit?: string } {
  return COMMIT ? { version: VERSION, commit: COMMIT } : { version: VERSION };
}
