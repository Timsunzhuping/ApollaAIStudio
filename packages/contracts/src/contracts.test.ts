import { describe, it, expect } from 'vitest';
import { Task, TaskState, RouteConfig, jsonSchemas } from './index';

describe('Task contract', () => {
  it('applies defaults for a minimal task', () => {
    const t = Task.parse({ id: 't1', type: 'research', state: 'plan', ownerId: 'u1' });
    expect(t.steps).toEqual([]);
    expect(t.sources).toEqual([]);
    expect(t.citations).toEqual([]);
    expect(t.totalCostUsd).toBe(0);
    expect(t.replayable).toBe(true);
  });

  it('enumerates the full state machine', () => {
    expect(TaskState.options).toEqual([
      'plan',
      'search',
      'extract',
      'compare',
      'generate',
      'deliver',
      'done',
      'failed',
    ]);
  });

  it('rejects an unknown state', () => {
    expect(() => Task.parse({ id: 't1', type: 'research', state: 'nope', ownerId: 'u1' })).toThrow();
  });
});

describe('RouteConfig contract', () => {
  it('defaults fallbackChain and keyPool to empty arrays', () => {
    const r = RouteConfig.parse({ alias: 'gpt_fast', primary: 'openai/x' });
    expect(r.fallbackChain).toEqual([]);
    expect(r.keyPool).toEqual([]);
  });
});

describe('jsonSchemas', () => {
  it('exposes derived JSON Schemas for shared contracts', () => {
    expect(jsonSchemas.Task).toBeTruthy();
    expect(jsonSchemas.RouteConfig).toBeTruthy();
    expect(Object.keys(jsonSchemas).length).toBeGreaterThanOrEqual(9);
  });
});
