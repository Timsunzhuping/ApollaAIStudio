import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  RouteConfig,
  FeatureGate,
  PromptVersion,
  SkillDef,
  ModelAlias,
  type RouteConfig as RouteConfigT,
  type FeatureGate as FeatureGateT,
  type PromptVersion as PromptVersionT,
  type SkillDef as SkillDefT,
} from '@apolla/contracts';
import { parseFrontmatter } from './frontmatter';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(pkgRoot, file), 'utf8'));
}

function listMarkdown(dir: string): string[] {
  const abs = path.join(pkgRoot, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(abs, f));
}

/** Load and validate alias→model routes. Throws if any required alias is missing. */
export function loadRoutes(): RouteConfigT[] {
  const raw = readJson('routes.json') as { routes?: unknown };
  const routes = z.array(RouteConfig).parse(raw.routes ?? []);
  const present = new Set(routes.map((r) => r.alias));
  for (const alias of ModelAlias.options) {
    if (!present.has(alias)) throw new Error(`routes.json is missing required alias: ${alias}`);
  }
  return routes;
}

/** Resolve a single route by alias. */
export function getRoute(alias: z.infer<typeof ModelAlias>): RouteConfigT {
  const route = loadRoutes().find((r) => r.alias === alias);
  if (!route) throw new Error(`No route configured for alias: ${alias}`);
  return route;
}

/** Load and validate feature gates (progressive enhancement). */
export function loadFeatureGates(): FeatureGateT[] {
  const raw = readJson('feature-gates.json') as { gates?: unknown };
  return z.array(FeatureGate).parse(raw.gates ?? []);
}

/** Load declarative prompts from packages/config/prompts/*.md (empty until T5). */
export function loadPrompts(): PromptVersionT[] {
  return listMarkdown('prompts').map((file) => {
    const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    return PromptVersion.parse({ ...data, template: body });
  });
}

/** Load declarative skills from packages/config/skills/*.md (empty until T10). */
export function loadSkills(): SkillDefT[] {
  return listMarkdown('skills').map((file) => {
    const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    return SkillDef.parse(data);
  });
}

export { parseFrontmatter } from './frontmatter';
