import { isAdmin } from '@apolla/bff/admin';
import type { CheckResult } from './checks';

/**
 * Operator console authz (S23): admin status is FAIL-CLOSED and comes only from the ADMIN_EMAILS
 * allowlist — never from a client-supplied field — so a user can't escalate themselves. Fully offline.
 */
export async function adminAuthz(): Promise<CheckResult> {
  const issues: string[] = [];
  const saved = process.env.ADMIN_EMAILS;
  try {
    // No allowlist configured → nobody is an admin.
    delete process.env.ADMIN_EMAILS;
    if (isAdmin('anyone@x.ai')) issues.push('empty allowlist still granted admin');

    process.env.ADMIN_EMAILS = 'boss@x.ai, ops@x.ai';
    if (!isAdmin('boss@x.ai')) issues.push('allowlisted email denied');
    if (!isAdmin('OPS@X.AI')) issues.push('allowlist not case-insensitive');
    if (isAdmin('intruder@x.ai')) issues.push('non-allowlisted email granted admin');
    if (isAdmin(undefined)) issues.push('missing email granted admin');
    if (isAdmin('')) issues.push('empty email granted admin');
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  }
  return { name: 'admin-authz', ok: issues.length === 0, issues };
}

export async function runAdminScenarios(): Promise<CheckResult[]> {
  return [await adminAuthz()];
}
