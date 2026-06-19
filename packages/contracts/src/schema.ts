import { zodToJsonSchema } from 'zod-to-json-schema';
import { ModelDescriptor, RouteConfig, FeatureGate, LLMRequest } from './model';
import { PromptVersion } from './prompt';
import { SkillDef } from './skill';
import { ToolResult } from './tool';
import { Task } from './task';
import { UsageRecord } from './usage';

/**
 * JSON Schemas derived from the zod contracts — the single source of truth shared across
 * the TS BFF and (future) Python AI Workers, and used by Provider Contract Tests.
 */
export const jsonSchemas = {
  Task: zodToJsonSchema(Task, 'Task'),
  RouteConfig: zodToJsonSchema(RouteConfig, 'RouteConfig'),
  ModelDescriptor: zodToJsonSchema(ModelDescriptor, 'ModelDescriptor'),
  FeatureGate: zodToJsonSchema(FeatureGate, 'FeatureGate'),
  LLMRequest: zodToJsonSchema(LLMRequest, 'LLMRequest'),
  PromptVersion: zodToJsonSchema(PromptVersion, 'PromptVersion'),
  SkillDef: zodToJsonSchema(SkillDef, 'SkillDef'),
  ToolResult: zodToJsonSchema(ToolResult, 'ToolResult'),
  UsageRecord: zodToJsonSchema(UsageRecord, 'UsageRecord'),
} as const;

export type JsonSchemaName = keyof typeof jsonSchemas;
