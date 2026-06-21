import { z } from 'zod';
import { SkillDef } from './skill';

/** A command alias exposed by a plugin → resolves to one of its skills. */
export const PluginCommand = z.object({ alias: z.string(), skill: z.string() });
export type PluginCommand = z.infer<typeof PluginCommand>;

/**
 * A Plugin bundles role-specific capabilities (PRD §15.2): self-contained Skills, the connectors
 * it needs, and command aliases. Installing one makes its skills available to that owner.
 */
export const Plugin = z.object({
  name: z.string(),
  description: z.string().default(''),
  skills: z.array(SkillDef).default([]),
  /** Connector names this plugin needs (flagged at install if not connected). */
  requiredConnectors: z.array(z.string()).default([]),
  commands: z.array(PluginCommand).default([]),
});
export type Plugin = z.infer<typeof Plugin>;
