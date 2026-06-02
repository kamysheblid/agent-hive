import * as path from 'path';
import * as os from 'os';

export type FeatureStatusType = 'planning' | 'approved' | 'executing' | 'completed';

export interface FeatureJson {
  name: string;
  status: FeatureStatusType;
  ticket?: string;
  sessionId?: string;
  createdAt: string;
  approvedAt?: string;
  completedAt?: string;
}

export type TaskStatusType = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'blocked' | 'failed' | 'partial';
export type TaskOrigin = 'plan' | 'manual';
export type SubtaskType = 'test' | 'implement' | 'review' | 'verify' | 'research' | 'debug' | 'custom';

export interface Subtask {
  id: string;
  name: string;
  folder: string;
  status: TaskStatusType;
  type?: SubtaskType;
  createdAt?: string;
  completedAt?: string;
}

export interface SubtaskStatus {
  status: TaskStatusType;
  type?: SubtaskType;
  createdAt: string;
  completedAt?: string;
}

/** Worker session information for background task execution */
export interface WorkerSession {
  /** Background task ID from OMO-Slim */
  taskId?: string;
  /** Unique session identifier */
  sessionId: string;
  /** Worker instance identifier */
  workerId?: string;
  /** Agent type handling this task */
  agent?: string;
  /** Execution mode: inline (same session) or delegate (background) */
  mode?: 'inline' | 'delegate';
  /** ISO timestamp of last heartbeat */
  lastHeartbeatAt?: string;
  /** Current attempt number (1-based) */
  attempt?: number;
  /** Number of messages exchanged in session */
  messageCount?: number;
}

export interface TaskStatus {
  /** Schema version for forward compatibility (default: 1) */
  schemaVersion?: number;
  status: TaskStatusType;
  origin: TaskOrigin;
  planTitle?: string;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
  baseCommit?: string;
  subtasks?: Subtask[];
  /** Idempotency key for safe retries */
  idempotencyKey?: string;
  /** Worker session info for background execution */
  workerSession?: WorkerSession;
  /**
   * Task dependencies expressed as task folder names (e.g., '01-setup', '02-core-api').
   * A task cannot start until all its dependencies have status 'done'.
   * Resolved from plan.md dependency annotations during hive_tasks_sync.
   */
  dependsOn?: string[];
}

export interface PlanComment {
  id: string;
  line: number;
  body: string;
  author: string;
  timestamp: string;
}

export interface CommentsJson {
  threads: PlanComment[];
}

export interface PlanReadResult {
  content: string;
  status: FeatureStatusType;
  comments: PlanComment[];
}

export interface TasksSyncResult {
  created: string[];
  removed: string[];
  kept: string[];
  manual: string[];
}

export interface TaskInfo {
  folder: string;
  name: string;
  status: TaskStatusType;
  origin: TaskOrigin;
  planTitle?: string;
  summary?: string;
}

export interface FeatureInfo {
  name: string;
  status: FeatureStatusType;
  tasks: TaskInfo[];
  hasPlan: boolean;
  commentCount: number;
}

export interface ContextFile {
  name: string;
  content: string;
  updatedAt: string;
}

export interface SessionInfo {
  sessionId: string;
  taskFolder?: string;
  startedAt: string;
  lastActiveAt: string;
  messageCount?: number;
}

export interface SessionsJson {
  master?: string;
  sessions: SessionInfo[];
}

export interface TaskSpec {
  taskFolder: string;
  featureName: string;
  planSection: string;
  context: string;
  priorTasks: Array<{ folder: string; summary?: string }>;
}

/** Agent model/temperature configuration */
export interface AgentModelConfig {
  /** Model to use - format: "provider/model-id" (e.g., 'anthropic/claude-sonnet-4-20250514') */
  model?: string;
  /** Temperature for generation (0-2) */
  temperature?: number;
  /** Skills to enable for this agent */
  skills?: string[];
  /** Skills to auto-load for this agent */
  autoLoadSkills?: string[];
  /** Variant key for model reasoning/effort level (e.g., 'low', 'medium', 'high', 'max') */
  variant?: string;
}

export const BUILT_IN_AGENT_NAMES = [
  'zetta',
  'architect-planner',
  'swarm-orchestrator',
  'scout-researcher',
  'forager-worker',
  'hygienic-reviewer',
] as const;

export type BuiltInAgentName = (typeof BUILT_IN_AGENT_NAMES)[number];

export const CUSTOM_AGENT_BASES = ['forager-worker', 'hygienic-reviewer'] as const;

export type CustomAgentBase = (typeof CUSTOM_AGENT_BASES)[number];

export const CUSTOM_AGENT_RESERVED_NAMES = [
  ...BUILT_IN_AGENT_NAMES,
  'hive',
  'architect',
  'swarm',
  'scout',
  'forager',
  'hygienic',
  'receiver',
  'build',
  'plan',
  'code',
] as const;

export interface CustomAgentConfig {
  baseAgent: CustomAgentBase;
  description: string;
  model?: string;
  temperature?: number;
  variant?: string;
  autoLoadSkills?: string[];
}

export interface ResolvedCustomAgentConfig extends AgentModelConfig {
  baseAgent: CustomAgentBase;
  description: string;
}

export interface HiveConfig {
  /** Schema reference for config file */
  $schema?: string;
  /** Enable hive tools for specific features */
  enableToolsFor?: string[];
  /** Globally disable specific skills (won't appear in hive_skill tool) */
  disableSkills?: string[];
  /** Globally disable specific MCP servers. Available: websearch, context7, grep_app, ast_grep */
  disableMcps?: string[];
  /** Enable OMO-Slim delegation (optional integration) */
  omoSlimEnabled?: boolean;
  /** Choose between unified or dedicated agent modes */
  agentMode?: 'unified' | 'dedicated';
  /** Agent configuration */
  agents?: {
    /** Zetta (hybrid planner + orchestrator) */
    'zetta'?: AgentModelConfig;
    /** Architect Planner (planning-only) */
    'architect-planner'?: AgentModelConfig;
    /** Swarm Orchestrator */
    'swarm-orchestrator'?: AgentModelConfig;
    /** Scout Researcher */
    'scout-researcher'?: AgentModelConfig;
    /** Forager Worker */
    'forager-worker'?: AgentModelConfig;
    /** Hygienic Reviewer */
    'hygienic-reviewer'?: AgentModelConfig;
  };
  customAgents?: Record<string, CustomAgentConfig>;
  /** Sandbox mode for worker isolation */
  sandbox?: 'none' | 'docker';
  /** Docker image to use when sandbox is 'docker' (optional explicit override) */
  dockerImage?: string;
  /** Reuse Docker containers per worktree (default: true when sandbox is 'docker') */
  persistentContainers?: boolean;
  /** Hook execution cadence (number of turns between hook invocations). Key = hook name, Value = cadence (1 = every turn, 3 = every 3rd turn) */
  hook_cadence?: Record<string, number>;
  /** Context compression configuration (DCP-style) */
  contextCompression?: {
    enabled?: boolean;
    threshold?: number;
    maxToolCalls?: number;
    protectedTools?: string[];
    protectUserMessages?: boolean;
  };
  /** Memory and session summarization configuration */
  memory?: {
    enabled?: boolean;
    autoSummarize?: boolean;
    summarizeAfterMessages?: number;
    useOpencodeDb?: boolean;
  };
  /** MCP API keys (also supports environment variables EXA_API_KEY, CONTEXT7_API_KEY) */
  mcpApiKeys?: {
    exa?: string;
    context7?: string;
  };
  /** Token truncation - compress large tool outputs to save context */
  tokenTruncation?: {
    enabled?: boolean;
    /** Maximum characters before truncation (default: 30000) */
    maxChars?: number;
    /** Keep first X% of content (default: 40) */
    keepFirstPercent?: number;
    /** Keep last X% of content (default: 40) */
    keepLastPercent?: number;
  };
  /** Session snapshot - preserve state across compaction for continuity */
  sessionSnapshot?: {
    enabled?: boolean;
    /** Maximum snapshot size in characters (default: 2048) */
    maxSnapshotChars?: number;
    /** Include active feature info (default: true) */
    includeActiveFeature?: boolean;
    /** Include pending tasks (default: true) */
    includePendingTasks?: boolean;
    /** Include modified files (default: false) */
    includeModifiedFiles?: boolean;
  };
  /** Snip integration - prefix shell commands with snip to reduce token usage */
  snip?: {
    enabled?: boolean;
    /** Custom snip path (default: 'snip') */
    command?: string;
  };
  /** Agent Booster - Ultra-fast code editing (Rust+WASM, 52x faster than Morph, FREE) */
  agentBooster?: {
    enabled?: boolean;
    /** Server URL (default: http://localhost:3001) */
    serverUrl?: string;
    /** Server port (default: 3001) */
    serverPort?: number;
  };
  /** Vector memory - HNSW indexing and semantic search */
  vectorMemory?: {
    enabled?: boolean;
    /** Path to store index files (default: ~/.config/opencode/hive/vector-index/) */
    indexPath?: string;
    /** Embedding dimensions (default: 384) */
    dimensions?: number;
    /** Auto-recall: automatically inject relevant vector memories into system prompt */
    autoRecall?: {
      enabled?: boolean;
      /** Maximum memories to inject per turn (default: 5) */
      maxMemories?: number;
      /** Filter by memory types (e.g., ['decision', 'learning', 'context']) */
      types?: string[];
      /** Filter by scope (e.g., 'auth', 'api') */
      scope?: string;
    };
    /** Auto-capture: automatically save session snapshots as vector memories during compaction (zero-API-call pattern) */
    autoCapture?: {
      enabled?: boolean;
      /** Memory type to use for captured snapshots (default: 'context') */
      type?: string;
      /** Include pending tasks (default: true) */
      includePendingTasks?: boolean;
      /** Provider mode: "manual" (use external API keys) or "opencode" (piggyback on session.prompt, from opencode-mem) */
      provider?: {
        /** Mode of auto-capture: "manual" or "opencode" (default: "manual" for backward compat) */
        mode?: 'manual' | 'opencode';
      };
    };
    /** Sharding: split vector memory into shards when it grows large */
    sharding?: {
      /** Maximum entries per shard before rotating (default: 500) */
      maxEntriesPerShard?: number;
    };
    /** Quality guards and deduplication */
    quality?: {
      /** Minimum content length to accept (default: 10) */
      minContentLength?: number;
      /** Reject content with excessive repeated characters like 'aaa...' (default: true) */
      rejectRepeatedChars?: boolean;
      /** Enable exact content dedup (default: true) */
      enableDedup?: boolean;
      /** Enable near-duplicate detection (default: false, requires scanning) */
      enableNearDedup?: boolean;
    };
    /** Memory filter: redact sensitive data before saving to memory */
    memoryFilter?: {
      enabled?: boolean;
      /** Custom regex patterns (each with name and pattern string, e.g., { name: "my-key", pattern: "MY_KEY_\\d+" }) */
      customPatterns?: Array<{ name: string; pattern: string }>;
      /** Also redact email addresses (default: false) */
      redactEmails?: boolean;
    };
    /** Auto-save: automatically save session context to project.md during compaction */
    autoSaveProject?: {
      enabled?: boolean;
      /** Maximum auto-saved entries to keep (default: 20, oldest removed when exceeded) */
      maxEntries?: number;
    };
    /** Compaction restoration: re-inject memories into session after compact (from opencode-mem) */
    compactionRestoration?: {
      enabled?: boolean;
      /** Maximum memories to re-inject per compact event (default: 5) */
      maxMemories?: number;
    };
  };
  /** Hidden-session judge: task completion verification via heuristic + LLM evaluation (from dzianisv/opencode-plugins) */
  hiddenJudge?: {
    enabled?: boolean;
    /** Maximum retries per task before stopping (default: 3, Reflexion-style) */
    maxRetries?: number;
    /** Minimum tool calls before judge activates (default: 5) */
    minToolCalls?: number;
    /** Write ratio threshold — if writes/total < this, flagged as planning loop (default: 0.1) */
    writeRatioThreshold?: number;
  };
  /** User profile learning: periodic AI analysis of user preferences (from opencode-mem). Opt-in only for privacy. */
  userProfile?: {
    enabled?: boolean;
    /** Number of user messages between profile analyses (default: 10) */
    analysisInterval?: number;
    /** Maximum stored preferences (default: 20) */
    maxPreferences?: number;
    /** Days before preference confidence decays by half (default: 30) */
    confidenceDecayDays?: number;
  };
}

/**
 * Default models for Hive agents.
 * All set to undefined by default so OpenCode uses the user's default provider/model.
 * Users can override via agent_hive.json → agents.<name>.model.
 */
export const DEFAULT_AGENT_MODELS: Record<string, string | undefined> = {
  'zetta': undefined,
  'architect-planner': undefined,
  'swarm-orchestrator': undefined,
  'scout-researcher': undefined,
  'forager-worker': undefined,
  'hygienic-reviewer': undefined,
};

export const DEFAULT_HIVE_CONFIG: HiveConfig = {
  $schema: 'https://raw.githubusercontent.com/hung319/agent-hive/main/packages/opencode-hive/schema/agent_hive.schema.json',
  enableToolsFor: [],
  disableSkills: [],
  disableMcps: [],
  agentMode: 'unified',
  sandbox: 'none',
  customAgents: {
    'forager-example-template': {
      baseAgent: 'forager-worker',
      description: 'Example template only: rename or delete this entry before use. Do not expect planners/orchestrators to select this placeholder agent as configured.',
      model: 'anthropic/claude-sonnet-4-20250514',
      temperature: 0.2,
      variant: 'high',
      autoLoadSkills: ['test-driven-development'],
    },
    'hygienic-example-template': {
      baseAgent: 'hygienic-reviewer',
      description: 'Example template only: rename or delete this entry before use. Do not expect planners/orchestrators to select this placeholder agent as configured.',
      autoLoadSkills: ['code-reviewer'],
    },
  },
  agents: {
    'zetta': {
      temperature: 0.5,
      skills: [],
      autoLoadSkills: ['parallel-exploration'],
    },
    'architect-planner': {
      temperature: 0.7,
      skills: [],
      autoLoadSkills: ['parallel-exploration'],
    },
    'swarm-orchestrator': {
      temperature: 0.5,
      skills: [],
      autoLoadSkills: [],
    },
    'scout-researcher': {
      temperature: 0.5,
      skills: [],
      autoLoadSkills: [],
    },
    'forager-worker': {
      temperature: 0.3,
      autoLoadSkills: ['test-driven-development', 'verification-before-completion'],
    },
    'hygienic-reviewer': {
      temperature: 0.3,
      skills: [],
      autoLoadSkills: [],
    },
  },
  // Token truncation: compress large tool outputs (enabled by default)
  tokenTruncation: {
    enabled: true,
    maxChars: 30000,
    keepFirstPercent: 40,
    keepLastPercent: 40,
  },
  // Session snapshot: preserve state across compaction (enabled by default)
  sessionSnapshot: {
    enabled: true,
    maxSnapshotChars: 2048,
    includeActiveFeature: true,
    includePendingTasks: true,
    includeModifiedFiles: false,
  },
  // Snip: reduce token usage for shell commands (requires snip CLI installed)
  snip: {
    enabled: false,  // Disabled by default, requires snip CLI
    command: 'snip',
  },
  // Agent Booster: Ultra-fast code editing (52x faster, FREE)
  agentBooster: {
    enabled: false,
    serverUrl: 'http://localhost:3001',
    serverPort: 3001,
  },
  // Vector memory: Semantic search enhancement
  vectorMemory: {
    enabled: false,
    indexPath: path.join(os.homedir(), '.config', 'opencode', 'hive', 'vector-index'),
    dimensions: 384,
    compactionRestoration: {
      enabled: true,
      maxMemories: 5,
    },
  },
  // Hidden judge: opt-in task completion verification
  hiddenJudge: {
    enabled: false,
    maxRetries: 3,
    minToolCalls: 5,
    writeRatioThreshold: 0.1,
  },
  // User profile: opt-in periodic AI analysis of preferences
  userProfile: {
    enabled: false,
    analysisInterval: 10,
    maxPreferences: 20,
    confidenceDecayDays: 30,
  },
};
