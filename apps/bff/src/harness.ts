import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import {
  ResearchOrchestrator,
  PromptRegistry,
  ToolRuntime,
  WebSearchTool,
  InMemoryCostLedger,
  InMemoryTaskRepository,
  InMemoryUserRepository,
  InMemoryProjectRepository,
  InMemoryMemory,
  PricingBook,
  type LLMAdapter,
  type TaskRepository,
  type UserRepository,
  type ProjectRepository,
  type Memory,
} from '@apolla/harness-core';
import { getRoute } from '@apolla/config';
import { OpenAIAdapter } from '@apolla/adapter-openai';
import { AnthropicAdapter } from '@apolla/adapter-anthropic';
import { StubSearchProvider } from '@apolla/search-stub';
import { TavilySearchProvider } from '@apolla/search-tavily';
import {
  createSql,
  migrate,
  PostgresTaskRepository,
  PostgresUserRepository,
  PostgresProjectRepository,
  PostgresMemory,
} from '@apolla/db-postgres';
import { DemoLLMAdapter } from './demo-adapter';

export interface Harness {
  orchestrator: ResearchOrchestrator;
  repo: TaskRepository;
  users: UserRepository;
  projects: ProjectRepository;
  memory: Memory;
  ledger: InMemoryCostLedger;
  pending: Map<string, { question: string; projectId?: string }>;
  mode: 'real' | 'demo';
  persistence: 'postgres' | 'memory';
  close: () => Promise<void>;
}

/**
 * Composition root — the one place real adapters and persistence are wired.
 * Models: OpenAI+Anthropic when keyed, else an offline DemoLLMAdapter.
 * Persistence: Postgres when DATABASE_URL is set (migrated on boot), else in-memory.
 */
export async function buildHarness(): Promise<Harness> {
  const useReal = !!process.env.OPENAI_API_KEY && !!process.env.ANTHROPIC_API_KEY;
  const adapters = new Map<string, LLMAdapter>();
  const pricing = new PricingBook();
  let routeFor: (alias: ModelAlias) => RouteConfig;

  if (useReal) {
    adapters.set('openai', new OpenAIAdapter());
    adapters.set('anthropic', new AnthropicAdapter());
    routeFor = getRoute;
  } else {
    adapters.set('demo', new DemoLLMAdapter());
    routeFor = (alias) => ({ alias, primary: `demo/${alias}`, fallbackChain: [], keyPool: ['DEMO_KEY'] });
    pricing.set('demo/gpt_premium', { in: 0.001, out: 0.002 });
    pricing.set('demo/claude_write', { in: 0.001, out: 0.002 });
  }

  const search = TavilySearchProvider.isConfigured()
    ? new TavilySearchProvider()
    : new StubSearchProvider();
  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(search));

  let repo: TaskRepository;
  let users: UserRepository;
  let projects: ProjectRepository;
  let memory: Memory;
  let persistence: Harness['persistence'];
  let close = async (): Promise<void> => {};

  if (process.env.DATABASE_URL) {
    const sql = createSql();
    await migrate(sql);
    repo = new PostgresTaskRepository(sql);
    users = new PostgresUserRepository(sql);
    projects = new PostgresProjectRepository(sql);
    memory = new PostgresMemory(sql);
    persistence = 'postgres';
    close = async () => {
      await sql.end();
    };
  } else {
    repo = new InMemoryTaskRepository();
    users = new InMemoryUserRepository();
    projects = new InMemoryProjectRepository();
    memory = new InMemoryMemory();
    persistence = 'memory';
  }

  const ledger = new InMemoryCostLedger(pricing);
  const orchestrator = new ResearchOrchestrator({
    adapters,
    prompts: new PromptRegistry(),
    tools,
    ledger,
    repo,
    memory,
    routeFor,
    env: { ...process.env, DEMO_KEY: 'demo' },
  });

  return {
    orchestrator,
    repo,
    users,
    projects,
    memory,
    ledger,
    pending: new Map(),
    mode: useReal ? 'real' : 'demo',
    persistence,
    close,
  };
}
