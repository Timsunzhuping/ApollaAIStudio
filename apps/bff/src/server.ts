import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportArtifact } from '@apolla/harness-core';
import { buildHarness } from './harness';
import { UI_HTML } from './ui';

const harness = buildHarness();
const OWNER = 'demo-user';

function json(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(s);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  // GET / — workspace UI
  if (method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(UI_HTML);
    return;
  }

  // GET /api/health
  if (method === 'GET' && pathname === '/api/health') {
    json(res, 200, { ok: true, mode: harness.mode });
    return;
  }

  // POST /api/tasks { question }
  if (method === 'POST' && pathname === '/api/tasks') {
    const body = await readBody(req).then((b) => (b ? JSON.parse(b) : {}));
    const question = String(body.question ?? '').trim();
    if (!question) return json(res, 400, { error: 'question is required' });
    const taskId = randomUUID();
    harness.pending.set(taskId, { question });
    return json(res, 201, { taskId });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(\/events|\/export)?$/);
  if (taskMatch) {
    const taskId = taskMatch[1]!;
    const sub = taskMatch[2];

    // GET /api/tasks/:id/events — SSE stream that runs the orchestrator
    if (method === 'GET' && sub === '/events') {
      const input = harness.pending.get(taskId);
      if (!input) return json(res, 404, { error: 'unknown task' });
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      try {
        for await (const ev of harness.orchestrator.run({ ownerId: OWNER, question: input.question, taskId })) {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      } catch (e) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) })}\n\n`);
      }
      res.end();
      return;
    }

    // GET /api/tasks/:id/export?fmt=md|html
    if (method === 'GET' && sub === '/export') {
      const task = await harness.repo.get(taskId);
      const artifact = task?.artifacts[0];
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

    // GET /api/tasks/:id — task json
    if (method === 'GET' && !sub) {
      const task = await harness.repo.get(taskId);
      return task ? json(res, 200, task) : json(res, 404, { error: 'unknown task' });
    }
  }

  json(res, 404, { error: 'not found' });
}

const PORT = Number(process.env.PORT ?? 3000);
createServer((req, res) => {
  handle(req, res).catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }));
}).listen(PORT, () => {
  console.log(`Apolla BFF [${harness.mode}] → http://localhost:${PORT}`);
});
