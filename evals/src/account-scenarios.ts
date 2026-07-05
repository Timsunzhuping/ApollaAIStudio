import { randomUUID } from 'node:crypto';
import {
  InMemoryProjectRepository,
  InMemorySkillRepository,
  InMemoryConnectorRepository,
  InMemoryScheduledTaskRepository,
  InMemoryNotificationRepository,
  InMemoryPluginRepository,
  InMemoryTaskRepository,
  InMemoryMemory,
  InMemoryWorkspaceRepository,
  InMemoryConversationRepository,
} from '@apolla/harness-core';
import { buildAccountBundle, importBundle } from '@apolla/bff/account';
import type { CheckResult } from './checks';

// A structural stand-in for the bits of the Harness the account aggregator touches — fully in-memory,
// so this guard runs offline with no database.
function dataSource() {
  return {
    projects: new InMemoryProjectRepository(),
    skillRepo: new InMemorySkillRepository(),
    connectors: new InMemoryConnectorRepository(),
    scheduleRepo: new InMemoryScheduledTaskRepository(),
    notifications: new InMemoryNotificationRepository(),
    plugins: new InMemoryPluginRepository(),
    repo: new InMemoryTaskRepository(),
    memory: new InMemoryMemory(),
    workspace: new InMemoryWorkspaceRepository(),
    conversations: new InMemoryConversationRepository(),
  };
}

/**
 * Account data lifecycle (S22): an export carries the owner's data but NEVER a secret, and importing a
 * bundle re-owns every row to the importer (no cross-tenant impersonation). Fully offline.
 */
export async function accountDataLifecycle(): Promise<CheckResult> {
  const issues: string[] = [];
  const src = dataSource();
  const owner = 'owner-a';

  await src.projects.create({ id: randomUUID(), ownerId: owner, name: 'Plan', description: 'mine' });
  await src.workspace.write({ ownerId: owner, path: 'a.md', content: 'hello' });
  await src.connectors.save({ id: randomUUID(), ownerId: owner, name: 'gh', transport: 'stub', args: [], readOnlyTools: [], disabledTools: [], enabled: true, tools: [], secrets: { token: 'TOP_SECRET' } });

  const bundle = await buildAccountBundle(src as never, owner, 'a@x.ai');
  if (!bundle.projects.some((p) => p.name === 'Plan')) issues.push('export missing project');
  if (JSON.stringify(bundle).includes('TOP_SECRET')) issues.push('export leaked a secret');
  if (Object.keys((bundle.connectors[0]?.secrets as object) ?? {}).length !== 0) issues.push('connector secrets not stripped');

  // Import into a different owner → everything is re-owned to the importer.
  const dst = dataSource();
  const importer = 'owner-b';
  await importBundle(dst as never, importer, bundle);
  const restored = await dst.projects.list(importer);
  if (restored.length !== 1) issues.push('import did not restore projects');
  if (restored[0] && restored[0].ownerId !== importer) issues.push('import did not re-own to the importer');
  if ((await dst.workspace.read(importer, 'a.md'))?.content !== 'hello') issues.push('import did not restore workspace');

  return { name: 'account-data-lifecycle', ok: issues.length === 0, issues };
}

export async function runAccountScenarios(): Promise<CheckResult[]> {
  return [await accountDataLifecycle()];
}
