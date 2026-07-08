import type { ModelAlias, RouteConfig } from '@apolla/contracts';
import {
  ResearchOrchestrator,
  PromptRegistry,
  ToolRuntime,
  WebSearchTool,
  WebFetchTool,
  StubFetchProvider,
  HttpFetchProvider,
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
  Coordinator,
  CoworkOrchestrator,
  InMemorySessionRepository,
  InMemoryApiTokenRepository,
  InMemorySubscriptionRepository,
  StubPaymentProvider,
  StubSpeechProvider,
  type SpeechProvider,
  InMemoryMagicLinkRepository,
  StubMagicLinkDelivery,
  type MagicLinkRepository,
  InMemoryCollabRepository,
  InMemoryCollabAccessRepository,
  type CollabRepository,
  type CollabAccessRepository,
  resolveEntitlements,
  StubOAuthProvider,
  InMemoryIdentityRepository,
  InMemoryOAuthStateStore,
  decryptSecret,
  type SessionRepository,
  type ApiTokenRepository,
  type SubscriptionRepository,
  type PaymentProvider,
  type IdentityRepository,
  type OAuthStateStore,
  type AuthProvider,
  InMemoryWorkspaceRepository,
  GuardedWorkspaceRepository,
  makeWorkspaceTools,
  WriterOrchestrator,
  SurfaceRuntime,
  genericExecutor,
  translateExecutor,
  sheetExecutor,
  notesExecutor,
  JobRunner,
  InProcessJobQueue,
  NoopTracer,
  type Tracer,
  Scheduler,
  notifyJobComplete,
  WebhookDelivery,
  InMemoryMediaRepository,
  InMemoryConnectorRepository,
  InMemoryAuditRepository,
  InMemoryProductEventRepository,
  InMemoryConversationRepository,
  InMemoryJobRepository,
  InMemoryScheduledTaskRepository,
  InMemoryNotificationRepository,
  InMemoryPluginRepository,
  type PluginRepository,
  type WorkspaceRepository,
  type MediaAdapter,
  type MediaRepository,
  type ConnectorRepository,
  type AuditRepository,
  type ProductEventRepository,
  type ConversationRepository,
  ChatOrchestrator,
  type JobRepository,
  type JobResolver,
  type JobQueue,
  type ScheduledTaskRepository,
  type NotificationRepository,
  type MCPClient,
  type LLMAdapter,
  type TaskRepository,
  type UserRepository,
  type ProjectRepository,
  type Memory,
  type SkillRepository,
} from '@apolla/harness-core';
import { getRoute, loadSkills, loadPlugins, loadSurfaces, loadConnectorCatalog, loadPlans, loadFeatureGates, getMediaRoute, loadPricing } from '@apolla/config';
import { StripePaymentProvider } from '@apolla/payment-stripe';
import { GoogleOAuthProvider, GitHubOAuthProvider } from '@apolla/auth-oauth';
import { RedisJobQueue } from '@apolla/queue-redis';
import { OtelTracer } from '@apolla/otel';
import { OpenAiSpeechProvider } from '@apolla/speech-openai';
import type { ModelCaps } from '@apolla/contracts';
import { OpenAIImageAdapter } from '@apolla/media-openai';
import { SeedanceVideoAdapter } from '@apolla/media-seedance';
import { StdioMCPClient, HttpMCPClient } from '@apolla/mcp-stdio';
import { LocalObjectStore } from './object-store';
import { metrics } from './obs';
import { OpenAIAdapter } from '@apolla/adapter-openai';
import { AnthropicAdapter } from '@apolla/adapter-anthropic';
import { StubSearchProvider } from '@apolla/search-stub';
import { TavilySearchProvider } from '@apolla/search-tavily';
import { DdgSearchProvider, BraveSearchProvider } from '@apolla/search-ddg';
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
  PostgresProductEventRepository,
  PostgresConversationRepository,
  PostgresJobRepository,
  PostgresScheduledTaskRepository,
  PostgresNotificationRepository,
  PostgresPluginRepository,
  PostgresWorkspaceRepository,
  PostgresSessionRepository,
  PostgresApiTokenRepository,
  PostgresSubscriptionRepository,
  PostgresIdentityRepository,
  PostgresMagicLinkRepository,
  PostgresCollabAccessRepository,
} from '@apolla/db-postgres';
import { DemoLLMAdapter } from './demo-adapter';
import { buildAdminApi, type AdminApi } from './admin';

/** Identity providers (S14): stub always (offline default); Google/GitHub only when env-keyed. */
function buildAuthProviders(): Map<string, AuthProvider> {
  const providers = new Map<string, AuthProvider>([['stub', new StubOAuthProvider()]]);
  if (process.env.GOOGLE_CLIENT_ID) providers.set('google', new GoogleOAuthProvider());
  if (process.env.GITHUB_CLIENT_ID) providers.set('github', new GitHubOAuthProvider());
  return providers;
}

export interface Harness {
  orchestrator: ResearchOrchestrator;
  chat: ChatOrchestrator;
  conversations: ConversationRepository;
  repo: TaskRepository;
  users: UserRepository;
  sessions: SessionRepository;
  apiTokens: ApiTokenRepository;
  subscriptions: SubscriptionRepository;
  payment: PaymentProvider;
  speech: SpeechProvider;
  magicLinks: MagicLinkRepository;
  magicLinkDelivery: StubMagicLinkDelivery;
  collab: CollabRepository;
  collabAccess: CollabAccessRepository;
  /** Irreversibly cascade-delete all of an owner's data (S22). Present only with a real database. */
  purgeOwner?: (ownerId: string) => Promise<void>;
  /** Operator-console aggregations (S23). Present only with a real database. */
  admin?: AdminApi;
  /** Readiness check (S24): pings the database. Present only with a real database. */
  ping?: () => Promise<void>;
  plans: () => import('@apolla/contracts').PlanDef[];
  identities: IdentityRepository;
  authProviders: Map<string, AuthProvider>;
  oauthStates: OAuthStateStore;
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
  /** Product-event log (S29): the source the north-star metric is derived from. */
  events: ProductEventRepository;
  jobs: JobRunner;
  jobRepo: JobRepository;
  jobQueue: JobQueue;
  tracer: Tracer;
  scheduler: Scheduler;
  scheduleRepo: ScheduledTaskRepository;
  notifications: NotificationRepository;
  plugins: PluginRepository;
  officialPlugins: () => import('@apolla/contracts').Plugin[];
  workspace: WorkspaceRepository;
  writer: WriterOrchestrator;
  surfaces: SurfaceRuntime;
  officialSurfaces: () => import('@apolla/contracts').Surface[];
  stubMcp: StubMCPClient;
  mcpClientFor: (transport: string) => MCPClient;
  connectorCatalog: () => import('@apolla/contracts').ConnectorCatalogEntry[];
  llmRouter: ModelRouter;
  prompts: PromptRegistry;
  agentToolsFor: (ownerId: string) => Promise<ToolRuntime>;
  pendingAgents: Map<string, { goal: string; ownerId: string }>;
  confirmMailbox: Map<string, (approved: boolean) => void>;
  objectStore: LocalObjectStore;
  ledger: InMemoryCostLedger;
  pending: Map<string, { question: string; ownerId: string; projectId?: string; skillName?: string }>;
  pendingMedia: Map<string, { alias: string; kind: string; prompt: string; ownerId: string; projectId?: string; sourceTaskId?: string }>;
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
  // Real mode with ANY provider key: register only the keyed adapters. The router's fallback chain
  // already skips models whose adapter/key is missing, so single-provider deployments (including
  // OpenAI-compatible gateways via OPENAI_BASE_URL + an APOLLA_ROUTES_FILE override) just work.
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useReal = hasOpenAI || hasAnthropic;
  const adapters = new Map<string, LLMAdapter>();
  const pricing = new PricingBook();
  let routeFor: (alias: ModelAlias) => RouteConfig;

  if (useReal) {
    if (hasOpenAI) adapters.set('openai', new OpenAIAdapter());
    if (hasAnthropic) adapters.set('anthropic', new AnthropicAdapter());
    routeFor = getRoute;
    // Cost metering: prices come from config/pricing.json (or the APOLLA_PRICING_FILE override).
    for (const [modelId, price] of Object.entries(loadPricing())) pricing.set(modelId, price);
  } else {
    adapters.set('demo', new DemoLLMAdapter());
    routeFor = (alias) => ({ alias, primary: `demo/${alias}`, fallbackChain: [], keyPool: ['DEMO_KEY'] });
    pricing.set('demo/gpt_premium', { in: 0.001, out: 0.002 });
    pricing.set('demo/claude_write', { in: 0.001, out: 0.002 });
  }

  // Search provider chain: Tavily (keyed) > keyless DuckDuckGo (SEARCH_PROVIDER=duckduckgo) > stub.
  const search = TavilySearchProvider.isConfigured()
    ? new TavilySearchProvider()
    : DdgSearchProvider.isConfigured()
      ? new DdgSearchProvider()
      : BraveSearchProvider.isConfigured()
        ? new BraveSearchProvider()
        : new StubSearchProvider();
  // S25: real page fetch when FETCH_MODE=http (or a live-model deploy); deterministic stub otherwise
  // so tests/CI and offline demo stay hermetic. The research SEARCH stage enriches with fetched text.
  const fetchProvider =
    (process.env.FETCH_MODE ?? '').toLowerCase() === 'http' ? new HttpFetchProvider() : new StubFetchProvider();
  const tools = new ToolRuntime();
  tools.register(new WebSearchTool(search));
  tools.register(new WebFetchTool(fetchProvider));

  let repo: TaskRepository;
  let users: UserRepository;
  let sessions: SessionRepository;
  let apiTokens: ApiTokenRepository;
  let subscriptions: SubscriptionRepository;
  let identities: IdentityRepository;
  let magicLinks: MagicLinkRepository;
  let collabAccess: CollabAccessRepository;
  let projects: ProjectRepository;
  let memory: Memory;
  let skillRepo: SkillRepository;
  let mediaRepo: MediaRepository;
  let connectorRepo: ConnectorRepository;
  let auditRepo: AuditRepository;
  let eventsRepo: ProductEventRepository;
  let conversationsRepo: ConversationRepository;
  let jobRepo: JobRepository;
  let scheduleRepo: ScheduledTaskRepository;
  let notificationRepo: NotificationRepository;
  let pluginRepo: PluginRepository;
  let workspaceRepo: WorkspaceRepository;
  let persistence: Harness['persistence'];
  let close = async (): Promise<void> => {};
  let purgeOwner: Harness['purgeOwner'];
  let admin: Harness['admin'];
  let ping: Harness['ping'];

  if (process.env.DATABASE_URL) {
    const sql = createSql();
    await migrate(sql);
    repo = new PostgresTaskRepository(sql);
    users = new PostgresUserRepository(sql);
    sessions = new PostgresSessionRepository(sql);
    apiTokens = new PostgresApiTokenRepository(sql);
    subscriptions = new PostgresSubscriptionRepository(sql);
    identities = new PostgresIdentityRepository(sql);
    magicLinks = new PostgresMagicLinkRepository(sql);
    collabAccess = new PostgresCollabAccessRepository(sql);
    projects = new PostgresProjectRepository(sql);
    memory = new PostgresMemory(sql);
    skillRepo = new PostgresSkillRepository(sql);
    mediaRepo = new PostgresMediaRepository(sql);
    connectorRepo = new PostgresConnectorRepository(sql);
    auditRepo = new PostgresAuditRepository(sql);
    eventsRepo = new PostgresProductEventRepository(sql);
    conversationsRepo = new PostgresConversationRepository(sql);
    jobRepo = new PostgresJobRepository(sql);
    scheduleRepo = new PostgresScheduledTaskRepository(sql);
    notificationRepo = new PostgresNotificationRepository(sql);
    pluginRepo = new PostgresPluginRepository(sql);
    workspaceRepo = new PostgresWorkspaceRepository(sql);
    persistence = 'postgres';
    close = async () => {
      await sql.end();
    };
    // Account deletion (S22): irreversibly cascade-purge ALL of one owner's data in a single
    // transaction. Owner-keyed tables by owner_id; identity tables by user_id; then the user row.
    purgeOwner = async (ownerId: string) => {
      const ownerTables = ['tasks', 'sessions', 'api_tokens', 'subscriptions', 'projects', 'memory_items', 'user_model', 'skills', 'media_tasks', 'connectors', 'audit_log', 'jobs', 'scheduled_tasks', 'notifications', 'plugins', 'workspace_files', 'product_events', 'conversations'];
      const userTables = ['oauth_identities', 'collab_access'];
      await sql.begin(async (tx) => {
        await tx`DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE owner_id = ${ownerId})`;
        for (const t of ownerTables) await tx.unsafe(`DELETE FROM ${t} WHERE owner_id = $1`, [ownerId]);
        for (const t of userTables) await tx.unsafe(`DELETE FROM ${t} WHERE user_id = $1`, [ownerId]);
        await tx`DELETE FROM users WHERE id = ${ownerId}`;
      });
    };
    admin = buildAdminApi(sql);
    ping = async () => { await sql`SELECT 1`; };
  } else {
    repo = new InMemoryTaskRepository();
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    apiTokens = new InMemoryApiTokenRepository();
    subscriptions = new InMemorySubscriptionRepository();
    identities = new InMemoryIdentityRepository();
    magicLinks = new InMemoryMagicLinkRepository();
    collabAccess = new InMemoryCollabAccessRepository();
    projects = new InMemoryProjectRepository();
    memory = new InMemoryMemory();
    skillRepo = new InMemorySkillRepository();
    mediaRepo = new InMemoryMediaRepository();
    connectorRepo = new InMemoryConnectorRepository();
    auditRepo = new InMemoryAuditRepository();
    eventsRepo = new InMemoryProductEventRepository();
    conversationsRepo = new InMemoryConversationRepository();
    jobRepo = new InMemoryJobRepository();
    scheduleRepo = new InMemoryScheduledTaskRepository();
    notificationRepo = new InMemoryNotificationRepository();
    pluginRepo = new InMemoryPluginRepository();
    workspaceRepo = new InMemoryWorkspaceRepository();
    persistence = 'memory';
  }

  // Guard all workspace writes: per-owner quota + audit every write (incl. traversal rejections).
  workspaceRepo = new GuardedWorkspaceRepository({ base: workspaceRepo, audit: (e) => auditRepo.record(e) });

  const ledger = new InMemoryCostLedger(pricing);
  const prompts = new PromptRegistry();
  // Tracer (S17): OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set, else Noop (zero-overhead).
  const tracer: Tracer = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? new OtelTracer() : new NoopTracer();
  const orchestrator = new ResearchOrchestrator({
    adapters,
    prompts,
    tools,
    ledger,
    repo,
    memory,
    routeFor,
    tracer,
    env: { ...process.env, DEMO_KEY: 'demo' },
  });

  // Unified chat (S28 / PRD §6.1): conversations with auto-compaction, next to research.
  const conversations = conversationsRepo;
  const chat = new ChatOrchestrator({
    adapters,
    prompts,
    conversations,
    ledger,
    routeFor,
    env: { ...process.env, DEMO_KEY: 'demo' },
  });

  // Skill Runtime: built-in config skills + user skills; research → orchestrator, else generic.
  const router = new ModelRouter({ adapters, routeFor, env: { ...process.env, DEMO_KEY: 'demo' }, onUsage: (e) => ledger.recordLLM(e), tracer });
  const skills = new SkillRuntime(
    new CompositeSkillSource(loadSkills(), skillRepo, pluginRepo),
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
  // Quota counts both research and media tasks (PRD §13 / S3-T7); the plan is resolved from the
  // owner's subscription → entitlements (S13). Fail-closed to free when there is no active sub.
  const plans = loadPlans();
  const quota = new Quota(
    (ownerId) => Promise.all([repo.list(ownerId), mediaRepo.list(ownerId)]).then(([a, b]) => a.length + b.length),
    async (ownerId) => resolveEntitlements(await subscriptions.get(ownerId), plans),
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
  const mcpClientFor = (transport: string): MCPClient =>
    transport === 'stdio' ? new StdioMCPClient() : transport === 'http' ? new HttpMCPClient() : stubMcp;

  // Build resolved (decrypted) auth headers for an http connector — sent only to its url's host.
  const httpHeadersFor = (c: { transport: string; secrets: Record<string, string> }): Record<string, string> | undefined => {
    if (c.transport !== 'http') return undefined;
    const dec = (n: string): string | undefined => (c.secrets[n] ? decryptSecret(c.secrets[n]!) : undefined);
    const authz = dec('authorization');
    const token = dec('token');
    if (authz) return { Authorization: authz };
    if (token) return { Authorization: `Bearer ${token}` };
    return undefined;
  };

  // Build the agent's tool set for an owner: built-in web_search + enabled connector tools.
  const agentToolsFor = async (ownerId: string): Promise<ToolRuntime> => {
    const rt = new ToolRuntime();
    rt.register(new WebSearchTool(search));
    rt.register(new WebFetchTool(fetchProvider));
    // Workspace file tools (S7): fs_read/fs_list (read) + fs_write (low_write), owner-scoped.
    for (const t of makeWorkspaceTools(workspaceRepo, { ownerId })) rt.register(t);
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
          headers: httpHeadersFor(c),
          timeoutMs: 10_000,
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
    if (spec.kind === 'cowork') {
      // Cowork (S6): plan → fan out to sub-agents → synthesize. Each sub-agent is a full agent run,
      // so it inherits Safety tiers + audit. As a (background) job it's non-interactive: only
      // pre-authorized low_write tools run (high_write always denied), and clarify defaults to null
      // (no human → never self-answers).
      const allowCowork = new Set((spec.allowTools ?? []) as string[]);
      return (async function* () {
        const tools = await agentToolsFor(ownerId);
        const agent = new AgentOrchestrator({ router, tools, prompts, audit: (e) => auditRepo.record(e) });
        const coordinator = new Coordinator({ agent, router, prompts, workspace: workspaceRepo });
        const cowork = new CoworkOrchestrator({ coordinator, router, prompts });
        yield* cowork.run({
          ownerId,
          goal: String(input.goal ?? input.question ?? ''),
          subgoals: Array.isArray(input.subgoals) ? (input.subgoals as string[]) : undefined,
          taskId: jobId,
          approve: async (call) => allowCowork.has(call.tool),
          // File collaboration is authorized iff fs_write is pre-authorized (background-safe).
          files: { enabled: allowCowork.has('fs_write'), basePath: `cowork/${jobId}` },
        });
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
  const delivery = process.env.NOTIFY_WEBHOOK_URL ? new WebhookDelivery(process.env.NOTIFY_WEBHOOK_URL) : undefined;
  // Execution substrate (S16): InProcess by default (web self-executes — unchanged behavior); a
  // distributed Redis(BullMQ) queue when REDIS_URL is set, behind the same JobQueue interface.
  const jobQueue: JobQueue = process.env.REDIS_URL ? new RedisJobQueue() : new InProcessJobQueue();
  const jobs = new JobRunner({
    repo: jobRepo,
    resolve: jobResolve,
    onComplete: (job) => notifyJobComplete(job, { repo: notificationRepo, delivery }),
    canRun: (id) => quota.check(id).then((q) => q.ok),
    queue: jobQueue,
    tracer,
    onMetric: (name, ms, ok) => metrics.operation(name, ms, ok), // SLO view (S17)
  });
  // In-process mode: the web consumes its own queue. Distributed mode: the web enqueues only and a
  // standalone worker registers the consumer (see workers/job-worker).
  if (jobQueue.inProcess) jobQueue.process((id) => jobs.run(id));
  const scheduler = new Scheduler({
    repo: scheduleRepo,
    trigger: (t) => {
      void jobs.start(t.ownerId, t.jobSpec, { scheduledTaskId: t.id });
    },
  });

  return {
    orchestrator,
    chat,
    conversations,
    repo,
    users,
    sessions,
    apiTokens,
    subscriptions,
    payment: process.env.STRIPE_SECRET_KEY ? new StripePaymentProvider() : new StubPaymentProvider(),
    // Speech (S19): OpenAI (Whisper + TTS) when keyed, else the offline Stub provider.
    // OpenAI speech only against the real OpenAI endpoint — OpenAI-compatible LLM gateways
    // (OPENAI_BASE_URL set, e.g. Ark/vLLM) rarely implement /audio/*, so fall back to the stub there.
    speech: OpenAiSpeechProvider.isConfigured() && !process.env.OPENAI_BASE_URL ? new OpenAiSpeechProvider() : new StubSpeechProvider(),
    // Magic-link (S20): single-use store + offline Stub delivery (real email is a deploy concern).
    magicLinks,
    magicLinkDelivery: new StubMagicLinkDelivery(),
    // Collab (S21): in-memory live sessions; access grants persist (Postgres/in-memory).
    collab: new InMemoryCollabRepository(),
    collabAccess,
    purgeOwner,
    admin,
    ping,
    plans: loadPlans,
    identities,
    // Identity providers: stub always (offline default); real providers when env-keyed (缺 key 不注册).
    authProviders: buildAuthProviders(),
    oauthStates: new InMemoryOAuthStateStore(),
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
    events: eventsRepo,
    jobs,
    jobRepo,
    jobQueue,
    tracer,
    scheduler,
    scheduleRepo,
    notifications: notificationRepo,
    plugins: pluginRepo,
    officialPlugins: loadPlugins,
    workspace: workspaceRepo,
    writer: new WriterOrchestrator({ router, prompts, workspace: workspaceRepo }),
    surfaces: new SurfaceRuntime({ router, prompts, workspace: workspaceRepo })
      .registerExecutor('generic', (c) => genericExecutor(c))
      .registerExecutor('translate', (c) => translateExecutor(c))
      .registerExecutor('sheet', (c) => sheetExecutor(c))
      .registerExecutor('notes', (c) => notesExecutor(c)),
    officialSurfaces: loadSurfaces,
    stubMcp,
    mcpClientFor,
    connectorCatalog: loadConnectorCatalog,
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
