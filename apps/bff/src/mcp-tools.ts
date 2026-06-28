import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defineTool, type CapabilityTool } from '@apolla/harness-core';
import type { Harness } from './harness';

/** Accumulate the streamed prose (`delta`) from an orchestrator/skill event stream. */
async function collect(stream: AsyncIterable<unknown>): Promise<string> {
  let out = '';
  for await (const ev of stream) {
    const e = ev as { type?: string; delta?: string };
    if (e.delta) out += e.delta;
  }
  return out.trim();
}

/** Run a text-input surface and return the written artifact's content (read back, owner-scoped). */
async function runSurface(harness: Harness, ownerId: string, surfaceId: string, text: string, params: Record<string, unknown>): Promise<string> {
  const surface = harness.officialSurfaces().find((s) => s.id === surfaceId);
  if (!surface) throw new Error(`unknown surface: ${surfaceId}`);
  const outputPath = `mcp/${surfaceId}-${randomUUID()}.md`;
  let path: string | undefined;
  let structured: unknown;
  let error: string | undefined;
  for await (const e of harness.surfaces.run({ ownerId, surface, text, params, outputPath })) {
    if (e.type === 'written') path = e.path;
    else if (e.type === 'structured') structured = e.data;
    else if (e.type === 'error') error = e.message;
  }
  if (error) throw new Error(error);
  if (path) {
    const f = await harness.workspace.read(ownerId, path);
    if (f) return f.content;
  }
  return structured ? JSON.stringify(structured, null, 2) : '(no output)';
}

/**
 * Apolla's capabilities exposed as MCP tools (S18) — all owner-scoped + read-only/low-risk, backed
 * by the existing orchestrators/surfaces/skills/workspace (so they inherit quota/safety/audit/trace).
 * No write/destructive/billable/autonomous capability is exposed here.
 */
export function buildCapabilityTools(harness: Harness): CapabilityTool[] {
  return [
    defineTool({
      name: 'apolla.research',
      description: 'Run a research task on a question and return the cited report.',
      inputSchema: z.object({ question: z.string().min(1) }),
      handler: async (ownerId, { question }) =>
        (await collect(harness.orchestrator.run({ ownerId, question, taskId: randomUUID() }))) || '(no content)',
    }),
    defineTool({
      name: 'apolla.translate',
      description: 'Translate text into a target language.',
      inputSchema: z.object({ text: z.string().min(1), targetLang: z.string().default('English') }),
      handler: (ownerId, { text, targetLang }) => runSurface(harness, ownerId, 'translate-text', text, { targetLang }),
    }),
    defineTool({
      name: 'apolla.summarize',
      description: 'Summarize a piece of text.',
      inputSchema: z.object({ text: z.string().min(1) }),
      handler: (ownerId, { text }) => runSurface(harness, ownerId, 'summarize', text, {}),
    }),
    defineTool({
      name: 'apolla.run_skill',
      description: 'Run one of your saved skills on a question.',
      inputSchema: z.object({ name: z.string().min(1), question: z.string().min(1) }),
      handler: async (ownerId, { name, question }) => {
        const skill = await harness.skills.get(name, ownerId);
        if (!skill) throw new Error(`unknown skill: ${name}`);
        return (await collect(harness.skills.run(skill, { ownerId, question, taskId: randomUUID() }))) || '(no content)';
      },
    }),
    defineTool({
      name: 'apolla.list_skills',
      description: 'List your available skills.',
      inputSchema: z.object({}),
      handler: async (ownerId) => {
        const skills = await harness.skills.list(ownerId);
        return JSON.stringify(skills.map((s) => ({ name: s.name, description: (s as { description?: string }).description ?? '' })), null, 2);
      },
    }),
    defineTool({
      name: 'apolla.workspace_list',
      description: 'List files in your workspace.',
      inputSchema: z.object({}),
      handler: async (ownerId) => {
        const entries = await harness.workspace.list(ownerId);
        return JSON.stringify(entries.map((e) => ({ path: e.path, version: e.version, size: e.size })), null, 2);
      },
    }),
    defineTool({
      name: 'apolla.workspace_read',
      description: 'Read a file from your workspace.',
      inputSchema: z.object({ path: z.string().min(1) }),
      handler: async (ownerId, { path }) => {
        const f = await harness.workspace.read(ownerId, path);
        if (!f) throw new Error(`not found: ${path}`);
        return f.content;
      },
    }),
  ];
}
