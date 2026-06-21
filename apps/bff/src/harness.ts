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
  InMemorySkillRepository,
  CompositeSkillSource,
  SkillRuntime,
  ModelRouter,
  makeResearchExecutor,
  makeGenericExecutor,
  makeMediaExecutor,
  makeAgentExecutor,
  FeatureGates,
  Quota,
  PricingBook,
  MediaRouter,
  MediaOrchestrator,
  StubMediaAdapter,
  RuleModerator,
  StubMCPClient,
  AgentOrchestrator,
  JobRunner,
  InMemoryMediaRepository,
  InMemoryConnectorRepository,
  InMemoryAuditRepository,
  InMemoryJobRepository,
  type MediaAdapter,
  type MediaRepository,
  type ConnectorRepository,
  type AuditRepository,
  type JobRepository,
  type JobResolver,
  type MCPClient,
  type LLMAdapter,
  type TaskRepository,
  type UserRepository,
  type ProjectRepository,
  type Memory,
  type SkillRepository,
} from '@apolla/harness-core';
import { getRoute, loadSkills, loadFeatureGates, getMediaRoute } from '@apolla/config';
import type { ModelCaps } from '@apolla/contracts';
import { OpenAIImageAdapter } from '@apolla/media-openai';
import { SeedanceVideoAdapter } from '@apolla/media-seedance';
import { StdioMCPClient } from '@apolla/mcp-stdio';
import { LocalObjectStore } from './object-store';
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
  PostgresSkillRepository,
  PostgresMediaRepository,
  PostgresConnectorRepository,
  PostgresAuditRepository,
  PostgresJobRepository,
} from '@apolla/db-postgres';
import { DemoLLMAdapter } from './demo-adapter';

export interface Harness {
  orchestrator: ResearchOrchestrator;
  repo: TaskRepository;
  users: UserRepository;
  projects: ProjectRepository;
  memory: Memory;
  skills: SkillRuntime;
  skillRepo: SkillRepository;
  features: FeatureGates;
  quota: Quota;
  mediaRouter: MediaRouter;
  mediaOrch: MediaOrchestrator;
  mediaRepo: MediaRepository;
  connectors: ConnectorRepository;
  audit: AuditRepository;
  jobs: JobRunner;
  jobRepo: JobRepository;
  stubMcp: StubMCPClient;
  mcpClientFor: (transport: string) => MCPClient;
  llmRouter: ModelRouter;
  prompts: PromptRegistry;
  agentToolsFor: (ownerId: string) => Promise<ToolRuntime>;
  pendingAgents: Map<string, { goal: string }>;
  confirmMailbox: Map<string, (approved: boolean) => void>;
  objectStore: LocalObjectStore;
  ledger: InMemoryCostLedger;
  pending: Map<string, { question: string; projectId?: string; skillName?: string }>;
  pendingMedia: Map<string, { alias: string; kind: string; prompt: string; projectId?: string; sourceTaskId?: string }>;
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
  let skillRepo: SkillRepository;
  let mediaRepo: MediaRepository;
  let connectorRepo: ConnectorRepository;
  let auditRepo: AuditRepository;
  let jobRepo: JobRepository;
  let persistence: Harness['persistence'];
  let close = async (): Promise<void> => {};

  if (process.env.DATABASE_URL) {
    const sql = createSql();
    await migrate(sql);
    repo = new PostgresTaskRepository(sql);
    users = new PostgresUserRepository(sql);
    projects = new PostgresProjectRepository(sql);
    memory = new PostgresMemory(sql);
    skillRepo = new PostgresSkillRepository(sql);
    mediaRepo = new PostgresMediaRepository(sql);
    connectorRepo = new PostgresConnectorRepository(sql);
    auditRepo = new PostgresAuditRepository(sql);
    jobRepo = new PostgresJobRepository(sql);
    persistence = 'postgres';
    close = async () => {
      await sql.end();
    };
  } else {
    repo = new InMemoryTaskRepository();
    users = new InMemoryUserRepository();
    projects = new InMemoryProjectRepository();
    memory = new InMemoryMemory();
    skillRepo = new InMemorySkillRepository();
    mediaRepo = new InMemoryMediaRepository();
    connectorRepo = new InMemoryConnectorRepository();
    auditRepo = new InMemoryAuditRepository();
    jobRepo = new InMemoryJobRepository();
    persistence = 'memory';
  }

  const ledger = new InMemoryCostLedger(pricing);
  const prompts = new PromptRegistry();
  const orchestrator = new ResearchOrchestrator({
    adapters,
    prompts,
    tools,
    ledger,
    repo,
    memory,
    routeFor,
    env: { ...process.env, DEMO_KEY: 'demo' },
  });

  // Skill Runtime: built-in config skills + user skills; research → orchestrator, else generic.
  const router = new ModelRouter({ adapters, routeFor, env: { ...process.env, DEMO_KEY: 'demo' }, onUsage: (e) => ledger.recordLLM(e) });
  const skills = new SkillRuntime(
    new CompositeSkillSource(loadSkills(), skillRepo),
    makeGenericExecutor({ router, prompts, tools }),
  );
  skills.registerExecutor('research', makeResearchExecutor(orchestrator));

  // Capability-gated features. Demo declares capable caps; real deployments recalibrate via probes.
  const caps: ModelCaps = {
    toolUse: true,
    parallelToolUse: false,
    longContext: 128_000,
    vision: false,
    reasoningDepth: 2,
    structuredReliability: 0.9,
    agenticReliability: 0.8,
  };
  const features = new FeatureGates(loadFeatureGates(), caps);
  // Quota counts both research and media tasks (PRD §13 / S3-T7).
  const quota = new Quota((ownerId) =>
    Promise.all([repo.list(ownerId), mediaRepo.list(ownerId)]).then(([a, b]) => a.length + b.length),
  );

  // Media: stub always registered (offline default); real providers when keyed.
  const mediaAdapters = new Map<string, MediaAdapter>([['stub', new StubMediaAdapter()]]);
  if (OpenAIImageAdapter.isConfigured()) mediaAdapters.set('openai', new OpenAIImageAdapter());
  if (SeedanceVideoAdapter.isConfigured()) mediaAdapters.set('seedance', new SeedanceVideoAdapter());
  const objectStore = new LocalObjectStore();
  const mediaRouter = new MediaRouter({ adapters: mediaAdapters, env: process.env, routeFor: getMediaRoute });
  const mediaOrch = new MediaOrchestrator({
    router: mediaRouter,
    repo: mediaRepo,
    store: objectStore,
    ledger,
    moderator: new RuleModerator(),
  });
  skills.registerExecutor('media', makeMediaExecutor(mediaOrch));

  // MCP: a shared in-process stub client (offline default) + a stdio client for local servers.
  const stubMcp = new StubMCPClient();
  const mcpClientFor = (transport: string): MCPClient => (transport === 'stdio' ? new StdioMCPClient() : stubMcp);

  // Build the agent's tool set for an owner: built-in web_search + enabled connector tools.
  const agentToolsFor = async (ownerId: string): Promise<ToolRuntime> => {
    const rt = new ToolRuntime();
    rt.register(new WebSearchTool(search));
    for (const c of await connectorRepo.list(ownerId)) {
      if (!c.enabled) continue;
      try {
        const registered = await rt.connectMCP(mcpClientFor(c.transport), {
          name: c.name,
          transport: c.transport,
          command: c.command,
          args: c.args,
          url: c.url,
          readOnlyTools: c.readOnlyTools,
        });
        for (const t of registered) {
          if (c.disabledTools.includes(t.name.slice(c.name.length + 1))) rt.unregister(t.name);
        }
      } catch {
        // skip an unreachable connector rather than failing the whole agent run
      }
    }
    return rt;
  };

  skills.registerExecutor(
    'agent',
    makeAgentExecutor({ router, prompts, toolsFor: agentToolsFor, audit: (e) => auditRepo.record(e) }),
  );

  // Background jobs: resolve a JobSpec to the right orchestrator's event stream.
  const jobResolve: JobResolver = (ownerId, spec, jobId) => {
    const input = spec.input as Record<string, unknown>;
    if (spec.kind === 'research') {
      return orchestrator.run({ ownerId, question: String(input.question ?? ''), taskId: jobId, projectId: input.projectId as string | undefined });
    }
    if (spec.kind === 'media') {
      const alias = String(input.alias ?? 'image_premium');
      return mediaOrch.run({
        ownerId,
        alias: alias as never,
        job: { kind: (alias.startsWith('video') ? 'video' : 'image') as never, prompt: String(input.prompt ?? input.question ?? ''), params: {} },
        taskId: jobId,
      });
    }
    if (spec.kind === 'skill') {
      return (async function* () {
        const skill = await skills.get(String(input.skill ?? ''), ownerId);
        if (!skill) throw new Error(`unknown skill: ${String(input.skill)}`);
        yield* skills.run(skill, { ownerId, question: String(input.question ?? ''), taskId: jobId });
      })();
    }
    // agent — background runs are non-interactive: only pre-authorized (allowTools) low_write
    // tools may run; high_write is always denied (S5-T7).
    const allow = new Set((spec.allowTools ?? []) as string[]);
    return (async function* () {
      const tools = await agentToolsFor(ownerId);
      const agent = new AgentOrchestrator({ router, tools, prompts, audit: (e) => auditRepo.record(e) });
      yield* agent.run({ ownerId, goal: String(input.goal ?? input.question ?? ''), taskId: jobId, approve: async (call) => allow.has(call.tool) });
    })();
  };
  const jobs = new JobRunner({ repo: jobRepo, resolve: jobResolve });

  return {
    orchestrator,
    repo,
    users,
    projects,
    memory,
    skills,
    skillRepo,
    features,
    quota,
    mediaRouter,
    mediaOrch,
    mediaRepo,
    connectors: connectorRepo,
    audit: auditRepo,
    jobs,
    jobRepo,
    stubMcp,
    mcpClientFor,
    llmRouter: router,
    prompts,
    agentToolsFor,
    pendingAgents: new Map(),
    confirmMailbox: new Map(),
    objectStore,
    ledger,
    pending: new Map(),
    pendingMedia: new Map(),
    mode: useReal ? 'real' : 'demo',
    persistence,
    close,
  };
}
