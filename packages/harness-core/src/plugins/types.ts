import type { Plugin, SkillDef } from '@apolla/contracts';

/** Installed plugins per owner (PRD §15.2). */
export interface PluginRepository {
  install(ownerId: string, plugin: Plugin): Promise<void>;
  list(ownerId: string): Promise<Plugin[]>;
  uninstall(ownerId: string, name: string): Promise<void>;
  /** All skills contributed by an owner's installed plugins (for the SkillSource). */
  skillsFor(ownerId: string): Promise<SkillDef[]>;
}
