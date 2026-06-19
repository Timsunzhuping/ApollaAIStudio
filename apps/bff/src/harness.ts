import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import {
  ResearchOrchestrator,
  PromptRegistry,
  ToolRuntime,
  WebSearchTool,
  InMemoryCostLedger,
  InMemoryTaskRepository,
  PricingBook,
  type LLMAdapter,
  type TaskRepository,
} from '@apolla/harness-core';
import { getRoute } from '@apolla/config';
import { OpenAIAdapter } from '@apolla/adapter-openai';
import { AnthropicAdapter } from '@apolla/adapter-anthropic';
import { StubSearchProvider } from '@apolla/search-stub';
import { TavilySearchProvider } from '@apolla/search-tavily';
import { DemoLLMAdapter } from './demo-adapter';

export interface Harness {
  orchestrator: ResearchOrchestrator;
  repo: TaskRepository;
  ledger: InMemoryCostLedger;
  pending: Map<string, { question: string }>;
  mode: 'real' | 'demo';
}

/**
 * Composition root — the one place real adapters are wired. With OpenAI+Anthropic keys it runs
 * the real models; otherwise it runs an offline demo adapter so the walking skeleton is usable
 * with zero configuration. Search uses Tavily when keyed, else the deterministic stub.
 */
export function buildHarness(): Harness {
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

  const repo = new InMemoryTaskRepository();
  const ledger = new InMemoryCostLedger(pricing);

  const orchestrator = new ResearchOrchestrator({
    adapters,
    prompts: new PromptRegistry(),
    tools,
    ledger,
    repo,
    routeFor,
    env: { ...process.env, DEMO_KEY: 'demo' },
  });

  return { orchestrator, repo, ledger, pending: new Map(), mode: useReal ? 'real' : 'demo' };
}
