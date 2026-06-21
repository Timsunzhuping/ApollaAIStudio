import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportArtifact, autoDraftSkill, embedMedia, encryptSecret, inferRisk, AgentOrchestrator, nextRun } from '@apolla/harness-core';
import type { Connector } from '@apolla/contracts';
import { buildHarness, type Harness } from './harness';
import { readSession, setSession, clearSession } from './auth';
import { UI_HTML } from './ui';

const harness: Harness = await buildHarness();

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // GET /media/:key — serve re-hosted media (public; uris are unguessable enough for the demo).
  if (method === 'GET' && pathname.startsWith('/media/')) {
    const obj = harness.objectStore.read(pathname.slice('/media/'.length));
    if (!obj) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': obj.mime });
    res.end(obj.bytes);
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

  // --- Audit ---
  if (method === 'GET' && pathname === '/api/audit') {
    const taskId = url.searchParams.get('taskId') ?? undefined;
    return json(res, 200, await harness.audit.list(ownerId, taskId));
  }

  // --- Notifications ---
  if (method === 'GET' && pathname === '/api/notifications') {
    return json(res, 200, await harness.notifications.list(ownerId));
  }
  const notifRead = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (method === 'POST' && notifRead) {
    await harness.notifications.markRead(ownerId, notifRead[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Plugins (Cowork §15.2): role-specific capability bundles ---
  if (method === 'GET' && pathname === '/api/plugins/official') {
    return json(res, 200, harness.officialPlugins());
  }
  if (method === 'GET' && pathname === '/api/plugins') {
    return json(res, 200, await harness.plugins.list(ownerId));
  }
  if (method === 'POST' && pathname === '/api/plugins/install') {
    const body = await readBody(req);
    const plugin = harness.officialPlugins().find((p) => p.name === String(body.name ?? ''));
    if (!plugin) return json(res, 404, { error: 'unknown plugin' });
    await harness.plugins.install(ownerId, plugin);
    // Flag any required connectors the owner has not connected yet (install still succeeds).
    const connected = new Set((await harness.connectors.list(ownerId)).map((c) => c.name));
    const missingConnectors = plugin.requiredConnectors.filter((rc) => !connected.has(rc));
    return json(res, 201, { plugin, missingConnectors });
  }
  const pluginDelete = pathname.match(/^\/api\/plugins\/([^/]+)$/);
  if (method === 'DELETE' && pluginDelete) {
    await harness.plugins.uninstall(ownerId, decodeURIComponent(pluginDelete[1]!));
    return json(res, 200, { ok: true });
  }

  // --- Scheduled tasks ---
  if (method === 'POST' && pathname === '/api/schedules') {
    const body = await readBody(req);
    const cron = String(body.cron ?? '').trim();
    const kind = String(body.kind ?? '');
    if (!cron || !['research', 'agent', 'skill', 'media'].includes(kind)) {
      return json(res, 400, { error: 'cron and a valid kind are required' });
    }
    let next: string | undefined;
    try {
      next = nextRun(cron, new Date())?.toISOString();
    } catch (e) {
      return json(res, 400, { error: `invalid cron: ${e instanceof Error ? e.message : String(e)}` });
    }
    const task = await harness.scheduleRepo.save({
      id: randomUUID(),
      ownerId,
      name: String(body.name ?? ''),
      cron,
      jobSpec: { kind: kind as never, input: (body.input ?? {}) as Record<string, unknown>, allowTools: Array.isArray(body.allowTools) ? body.allowTools : [] },
      enabled: true,
      nextRunAt: next,
    });
    return json(res, 201, task);
  }
  if (method === 'GET' && pathname === '/api/schedules') {
    return json(res, 200, await harness.scheduleRepo.list(ownerId));
  }
  const schedToggle = pathname.match(/^\/api\/schedules\/([^/]+)\/toggle$/);
  if (method === 'POST' && schedToggle) {
    const t = await harness.scheduleRepo.get(schedToggle[1]!);
    if (!t || t.ownerId !== ownerId) return json(res, 404, { error: 'unknown schedule' });
    const body = await readBody(req);
    const saved = await harness.scheduleRepo.save({ ...t, enabled: body.enabled !== false });
    return json(res, 200, saved);
  }
  const schedRunNow = pathname.match(/^\/api\/schedules\/([^/]+)\/run-now$/);
  if (method === 'POST' && schedRunNow) {
    const t = await harness.scheduleRepo.get(schedRunNow[1]!);
    if (!t || t.ownerId !== ownerId) return json(res, 404, { error: 'unknown schedule' });
    const { job } = await harness.jobs.start(ownerId, t.jobSpec, { scheduledTaskId: t.id });
    return json(res, 201, { jobId: job.id });
  }
  const schedDelete = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (method === 'DELETE' && schedDelete) {
    await harness.scheduleRepo.delete(ownerId, schedDelete[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Background jobs ---
  if (method === 'POST' && pathname === '/api/jobs') {
    const body = await readBody(req);
    const kind = String(body.kind ?? '');
    if (!['research', 'agent', 'skill', 'media'].includes(kind)) return json(res, 400, { error: 'invalid job kind' });
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const { job } = await harness.jobs.start(ownerId, {
      kind: kind as never,
      input: (body.input ?? {}) as Record<string, unknown>,
      allowTools: Array.isArray(body.allowTools) ? body.allowTools : [],
    });
    return json(res, 201, { jobId: job.id });
  }
  if (method === 'GET' && pathname === '/api/jobs') {
    return json(res, 200, await harness.jobRepo.list(ownerId));
  }
  const jobEvents = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
  if (method === 'GET' && jobEvents) {
    const jobId = jobEvents[1]!;
    const job0 = await harness.jobRepo.get(jobId);
    if (!job0 || job0.ownerId !== ownerId) return json(res, 404, { error: 'unknown job' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let sent = 0;
    for (;;) {
      const evs = await harness.jobRepo.events(jobId);
      for (; sent < evs.length; sent++) res.write(`data: ${JSON.stringify(evs[sent])}\n\n`);
      const job = await harness.jobRepo.get(jobId);
      if (!job || job.status === 'done' || job.status === 'failed') {
        res.write(`data: ${JSON.stringify({ type: 'job-status', status: job?.status ?? 'failed' })}\n\n`);
        break;
      }
      await sleep(300);
    }
    res.end();
    return;
  }
  const jobOne = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobOne) {
    const job = await harness.jobRepo.get(jobOne[1]!);
    return job && job.ownerId === ownerId ? json(res, 200, job) : json(res, 404, { error: 'unknown job' });
  }

  // --- Agent (multi-tool, tiered confirmation) ---
  if (method === 'POST' && pathname === '/api/agent') {
    const body = await readBody(req);
    const goal = String(body.goal ?? '').trim();
    if (!goal) return json(res, 400, { error: 'goal required' });
    const agentId = randomUUID();
    harness.pendingAgents.set(agentId, { goal });
    return json(res, 201, { agentId });
  }
  if (method === 'POST' && pathname.match(/^\/api\/agent\/[^/]+\/confirm$/)) {
    const id = pathname.split('/')[3]!;
    const body = await readBody(req);
    const waiter = harness.confirmMailbox.get(id);
    if (!waiter) return json(res, 404, { error: 'no pending confirmation' });
    waiter(body.approved === true);
    harness.confirmMailbox.delete(id);
    return json(res, 200, { ok: true });
  }
  const agentEvents = pathname.match(/^\/api\/agent\/([^/]+)\/events$/);
  if (method === 'GET' && agentEvents) {
    const agentId = agentEvents[1]!;
    const input = harness.pendingAgents.get(agentId);
    if (!input) return json(res, 404, { error: 'unknown agent task' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const tools = await harness.agentToolsFor(ownerId);
    const agent = new AgentOrchestrator({
      router: harness.llmRouter,
      tools,
      prompts: harness.prompts,
      audit: (entry) => harness.audit.record(entry),
    });
    // Confirmation: pause until POST /api/agent/:id/confirm arrives (or 60s timeout → deny).
    const approve = (): Promise<boolean> =>
      new Promise((resolve) => {
        const t = setTimeout(() => {
          harness.confirmMailbox.delete(agentId);
          resolve(false);
        }, 60_000);
        harness.confirmMailbox.set(agentId, (ok) => {
          clearTimeout(t);
          resolve(ok);
        });
      });
    try {
      for await (const ev of agent.run({ ownerId, goal: input.goal, taskId: agentId, approve })) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
    }
    res.end();
    return;
  }

  // --- Connectors (MCP) ---
  if (method === 'POST' && pathname === '/api/connectors') {
    const body = await readBody(req);
    const transport = String(body.transport ?? 'stub');
    const server = {
      name: String(body.name ?? '').trim() || 'connector',
      transport: transport as 'stub' | 'stdio' | 'http',
      command: body.command,
      args: Array.isArray(body.args) ? body.args : [],
      url: body.url,
      readOnlyTools: Array.isArray(body.readOnlyTools) ? body.readOnlyTools : [],
    };
    // Connect once to enumerate the server's tools + infer risk.
    let tools: Connector['tools'] = [];
    try {
      const session = await harness.mcpClientFor(transport).connect(server as never);
      const defs = await session.listTools();
      tools = defs.map((d) => ({ name: d.name, risk: inferRisk(d, server as never) }));
      await session.close();
    } catch (e) {
      return json(res, 400, { error: `could not connect: ${e instanceof Error ? e.message : String(e)}` });
    }
    const secrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.secrets ?? {})) secrets[k] = encryptSecret(String(v));
    const connector: Connector = {
      id: randomUUID(),
      ownerId,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      readOnlyTools: server.readOnlyTools,
      disabledTools: [],
      enabled: true,
      tools,
      secrets,
    };
    await harness.connectors.save(connector);
    return json(res, 201, { ...connector, secrets: Object.keys(secrets) });
  }
  if (method === 'GET' && pathname === '/api/connectors') {
    const list = await harness.connectors.list(ownerId);
    return json(res, 200, list.map((c) => ({ ...c, secrets: Object.keys(c.secrets) })));
  }
  const connToggle = pathname.match(/^\/api\/connectors\/([^/]+)\/tool$/);
  if (method === 'POST' && connToggle) {
    const c = await harness.connectors.get(connToggle[1]!);
    if (!c || c.ownerId !== ownerId) return json(res, 404, { error: 'unknown connector' });
    const body = await readBody(req);
    const tool = String(body.tool ?? '');
    const enabled = body.enabled !== false;
    const disabled = new Set(c.disabledTools);
    if (enabled) disabled.delete(tool);
    else disabled.add(tool);
    await harness.connectors.save({ ...c, disabledTools: [...disabled] });
    return json(res, 200, { ok: true, disabledTools: [...disabled] });
  }
  const connDelete = pathname.match(/^\/api\/connectors\/([^/]+)$/);
  if (method === 'DELETE' && connDelete) {
    await harness.connectors.delete(ownerId, connDelete[1]!);
    return json(res, 200, { ok: true });
  }

  // --- Media ---
  if (method === 'POST' && pathname === '/api/media') {
    const body = await readBody(req);
    const alias = String(body.alias ?? '');
    const prompt = String(body.prompt ?? '').trim();
    const kind = alias.startsWith('video') ? 'video' : 'image';
    if (!prompt) return json(res, 400, { error: 'prompt required' });
    if (!['image_fast', 'image_premium', 'video_standard', 'video_premium'].includes(alias)) {
      return json(res, 400, { error: 'invalid media alias' });
    }
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const estimateUsd = harness.mediaRouter.estimateCost(alias as never, { kind: kind as never, prompt, params: {} }).usd;
    // High-cost (video) requires explicit confirmation before we stage the run (PRD §13 / S3-T7).
    if (kind === 'video' && !body.confirm) {
      return json(res, 200, { requiresConfirmation: true, estimateUsd });
    }
    const mediaId = randomUUID();
    harness.pendingMedia.set(mediaId, { alias, kind, prompt, projectId: body.projectId });
    return json(res, 201, { mediaId, estimateUsd });
  }
  if (method === 'GET' && pathname === '/api/media') {
    return json(res, 200, await harness.mediaRepo.list(ownerId));
  }
  const mediaEvents = pathname.match(/^\/api\/media\/([^/]+)\/events$/);
  if (method === 'GET' && mediaEvents) {
    const mediaId = mediaEvents[1]!;
    const input = harness.pendingMedia.get(mediaId);
    if (!input) return json(res, 404, { error: 'unknown media task' });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    try {
      for await (const ev of harness.mediaOrch.run({
        ownerId,
        alias: input.alias as never,
        job: { kind: input.kind as never, prompt: input.prompt, params: {} },
        taskId: mediaId,
        projectId: input.projectId,
        sourceTaskId: input.sourceTaskId,
      })) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
    }
    res.end();
    return;
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

  // Research → media chaining (S3-T9): stage a media task using the research question as the prompt.
  const taskMedia = pathname.match(/^\/api\/tasks\/([^/]+)\/media$/);
  if (method === 'POST' && taskMedia) {
    const task = await harness.repo.get(taskMedia[1]!);
    if (!task || task.ownerId !== ownerId) return json(res, 404, { error: 'unknown task' });
    const body = await readBody(req);
    const alias = String(body.alias ?? 'image_premium');
    const kind = alias.startsWith('video') ? 'video' : 'image';
    const q = await harness.quota.check(ownerId);
    if (!q.ok) return json(res, 402, { error: 'quota reached — upgrade your plan', ...q });
    const estimateUsd = harness.mediaRouter.estimateCost(alias as never, { kind: kind as never, prompt: '', params: {} }).usd;
    if (kind === 'video' && !body.confirm) return json(res, 200, { requiresConfirmation: true, estimateUsd });
    const mediaId = randomUUID();
    const prompt = `${kind === 'video' ? 'A short explainer video' : 'A cover image'} for: ${task.question ?? 'the research report'}`;
    harness.pendingMedia.set(mediaId, { alias, kind, prompt, projectId: task.projectId, sourceTaskId: task.id });
    return json(res, 201, { mediaId, estimateUsd });
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
      // Embed any media generated for this research task (research→media, S3-T9).
      const media = (await harness.mediaRepo.list(ownerId)).filter((m) => m.sourceTaskId === taskId && m.status === 'ready');
      const assets = media.flatMap((m) => m.assets);
      const embedded = assets.length ? { ...artifact, content: embedMedia(artifact.content ?? '', assets) } : artifact;
      const fmt = url.searchParams.get('fmt') === 'html' ? 'html' : 'markdown';
      const file = exportArtifact(embedded, fmt);
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

// In-process cron tick (S5-T3). Production would use a durable queue/worker instead.
setInterval(() => {
  harness.scheduler.tick(new Date()).catch(() => {});
}, 30_000);
