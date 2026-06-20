import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportArtifact, autoDraftSkill } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { readSession, setSession, clearSession } from './auth';
import { UI_HTML } from './ui';

const harness: Harness = await buildHarness();

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function projectContext(projectId: string | undefined, ownerId: string): Promise<string | undefined> {
  if (!projectId) return undefined;
  const p = await harness.projects.get(projectId);
  if (!p || p.ownerId !== ownerId) return undefined;
  return `Project context — "${p.name}": ${p.description}`.trim();
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(UI_HTML);
    return;
  }
  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      mode: harness.mode,
      persistence: harness.persistence,
      features: { auto_skill_write: harness.features.enabled('auto_skill_write') },
    });
  }

  // --- Auth ---
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) return json(res, 400, { error: 'valid email required' });
    const user = await harness.users.upsertByEmail(email);
    setSession(res, user.id);
    return json(res, 200, { id: user.id, email: user.email });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    clearSession(res);
    return json(res, 200, { ok: true });
  }

  // Everything below requires a session.
  const ownerId = readSession(req);
  if (method === 'GET' && pathname === '/api/auth/me') {
    if (!ownerId) return json(res, 401, { error: 'not authenticated' });
    const user = await harness.users.get(ownerId);
    return user ? json(res, 200, user) : json(res, 401, { error: 'not authenticated' });
  }
  if (!ownerId) return json(res, 401, { error: 'not authenticated' });

  // --- Projects ---
  if (method === 'POST' && pathname === '/api/projects') {
    const body = await readBody(req);
    const name = String(body.name ?? '').trim();
    if (!name) return json(res, 400, { error: 'name required' });
    const project = await harness.projects.create({
      id: randomUUID(),
      ownerId,
      name,
      description: String(body.description ?? ''),
    });
    return json(res, 201, project);
  }
  if (method === 'GET' && pathname === '/api/projects') {
    return json(res, 200, await harness.projects.list(ownerId));
  }

  // --- Memory / preferences ---
  if (method === 'GET' && pathname === '/api/memory/model') {
    return json(res, 200, (await harness.memory.getUserModel(ownerId)) ?? { ownerId, formats: [] });
  }
  if (method === 'POST' && pathname === '/api/memory/model') {
    const body = await readBody(req);
    return json(res, 200, await harness.memory.setUserModel(ownerId, body));
  }
  if (method === 'DELETE' && pathname === '/api/memory') {
    await harness.memory.clear(ownerId);
    return json(res, 200, { ok: true });
  }

  // --- Skills ---
  if (method === 'GET' && pathname === '/api/skills') {
    return json(res, 200, await harness.skills.list(ownerId));
  }
  if (method === 'DELETE' && pathname.startsWith('/api/skills/')) {
    const name = decodeURIComponent(pathname.slice('/api/skills/'.length));
    await harness.skillRepo.delete(ownerId, name);
    return json(res, 200, { ok: true });
  }
  if (method === 'POST' && pathname === '/api/skills/run') {
    // Stage a skill rerun as a task (streamed via /api/tasks/:id/events).
    const body = await readBody(req);
    const skill = await harness.skills.get(String(body.name ?? ''), ownerId);
    if (!skill) return json(res, 404, { error: 'unknown skill' });
    const question = String(body.question ?? '').trim();
    if (!question) return json(res, 400, { error: 'question required' });
    const taskId = randomUUID();
    harness.pending.set(taskId, { question, skillName: skill.name });
    return json(res, 201, { taskId });
  }

  const saveSkill = pathname.match(/^\/api\/tasks\/([^/]+)\/save-as-skill$/);
  if (method === 'POST' && saveSkill) {
    const task = await harness.repo.get(saveSkill[1]!);
    if (!task || task.ownerId !== ownerId) return json(res, 404, { error: 'unknown task' });
    if (!harness.features.enabled('auto_skill_write')) {
      return json(res, 403, { error: 'auto_skill_write is not available for the current model tier' });
    }
    const draft = autoDraftSkill(task);
    if (!draft) return json(res, 400, { error: 'task is not a completed research task' });
    const saved = await harness.skillRepo.save(ownerId, draft);
    return json(res, 201, saved);
  }

  // --- Tasks ---
  if (method === 'POST' && pathname === '/api/tasks') {
    const body = await readBody(req);
    const question = String(body.question ?? '').trim();
    if (!question) return json(res, 400, { error: 'question is required' });
    const q = await harness.quota.check(ownerId);
    if (!q.ok) {
      return json(res, 402, { error: 'task quota reached — upgrade your plan', used: q.used, limit: q.limit, plan: q.plan });
    }
    const taskId = randomUUID();
    harness.pending.set(taskId, { question, projectId: body.projectId });
    // Static pre-run cost estimate for a research task (high-cost task hint, PRD §6.8).
    return json(res, 201, { taskId, estimatedCostUsd: 0.002, quota: q });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(\/events|\/export)?$/);
  if (taskMatch) {
    const taskId = taskMatch[1]!;
    const sub = taskMatch[2];

    if (method === 'GET' && sub === '/events') {
      const input = harness.pending.get(taskId);
      if (!input) return json(res, 404, { error: 'unknown task' });
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      try {
        const systemAddendum = await projectContext(input.projectId, ownerId);
        const skill = input.skillName ? await harness.skills.get(input.skillName, ownerId) : undefined;
        const stream = skill
          ? harness.skills.run(skill, { ownerId, question: input.question, taskId, projectId: input.projectId })
          : harness.orchestrator.run({ ownerId, question: input.question, taskId, projectId: input.projectId, systemAddendum });
        for await (const ev of stream) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
      }
      res.end();
      return;
    }

    if (method === 'GET' && sub === '/export') {
      const task = await harness.repo.get(taskId);
      if (!task || task.ownerId !== ownerId) return json(res, 404, { error: 'no artifact' });
      const artifact = task.artifacts[0];
      if (!artifact) return json(res, 404, { error: 'no artifact' });
      const fmt = url.searchParams.get('fmt') === 'html' ? 'html' : 'markdown';
      const file = exportArtifact(artifact, fmt);
      res.writeHead(200, {
        'content-type': file.mime,
        'content-disposition': `attachment; filename="${file.filename}"`,
      });
      res.end(file.content);
      return;
    }

    if (method === 'GET' && !sub) {
      const task = await harness.repo.get(taskId);
      return task && task.ownerId === ownerId ? json(res, 200, task) : json(res, 404, { error: 'unknown task' });
    }
  }

  json(res, 404, { error: 'not found' });
}

const PORT = Number(process.env.PORT ?? 3000);
createServer((req, res) => {
  handle(req, res).catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }));
}).listen(PORT, () => {
  console.log(`Apolla BFF [${harness.mode}/${harness.persistence}] → http://localhost:${PORT}`);
});
