import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { tool, type Plugin, type ToolDefinition } from "@opencode-ai/plugin";
import { getFilteredSkills, loadBuiltinSkill } from './skills/builtin.js';
import { loadFileSkill } from './skills/file-loader.js';
import { BUILTIN_SKILLS } from './skills/registry.generated.js';
import type { SkillDefinition } from './skills/types.js';
// Tools
import { lookAtTool } from './tools/look-at.js';
import { artifactSearchTool } from './tools/artifact-search.js';
import { btcaAskTool } from './tools/btca-ask.js';
import { ptyStartTool, ptySendTool, ptyReadTool, ptyKillTool, ptyListTool } from './tools/pty.js';
// LSP Tools
import { 
  lspRenameTool, 
  lspGotoDefinitionTool, 
  lspFindReferencesTool, 
  lspDiagnosticsTool, 
  lspHoverTool, 
  lspCodeActionsTool,
  lspStatusTool,
  lspInstallTool,
} from './tools/lsp.js';
// Skill-Embedded MCP Tools
import { skillMcpTool, listSkillMcpsTool } from './tools/skill-mcp.js';
// Memory Tools
import { hiveMemoryListTool, hiveMemorySetTool, hiveMemoryReplaceTool, hiveJournalWriteTool, hiveJournalSearchTool, hiveMemoryRecallTool, hiveMemoryUpdateTool, hiveMemoryForgetTool, buildMemoryInjection, ensureMemorySeeded } from './tools/memory.js';
// Agent Booster Tools (ultra-fast code editing)
import { hiveCodeEditTool, hiveLazyEditTool, hiveBoosterStatusTool } from './tools/agent-booster.js';
// Vector Memory Tools (semantic search)
import { hiveVectorSearchTool, hiveVectorAddTool, hiveVectorStatusTool } from './tools/vector-memory.js';
import { listMemories, searchMemories, addMemory, setShardingConfig, setQualityConfig, setMemoryFilterConfig as setVectorMemoryFilterConfig } from './services/vector-memory.js';
import { formatAutoRecallInjection, buildCaptureSnapshot } from './utils/auto-recall.js';
import { setMemoryFilterConfig as setBlockMemoryFilterConfig } from './tools/memory.js';
import { reInjectMemoriesAfterCompact } from './utils/compaction-restoration.js';
import { safeHook } from './utils/safe-stage.js';
import { HiddenJudgeService } from './services/hidden-judge.js';
import { OpenCodeProviderService } from './services/opencode-provider.js';
import { UserProfileService } from './services/user-profile.js';
import { ensureLspServers } from './services/lsp-autoinstall.js';


// Dora CLI Tools (SCIP-based code navigation)
import {
  doraStatusTool, 
  doraSymbolTool, 
  doraFileTool, 
  doraReferencesTool,
  doraCyclesTool,
  doraUnusedTool,
} from './tools/dora.js';

// Auto-CR Tools (SWC-based code review)
import { 
  autoCrStatusTool, 
  autoCrScanTool, 
  autoCrDiffTool, 
  autoCrRulesTool,
} from './tools/auto-cr.js';

// Directory Explorer Tool
import { exploreDirectoryTool } from './tools/explore-directory-tool.js';

// Bee agents (lean, focused)
import { QUEEN_BEE_PROMPT } from './agents/hive.js';
import { SCOUT_BEE_PROMPT } from './agents/scout.js';
import { FORAGER_BEE_PROMPT } from './agents/forager.js';
import { HYGIENIC_BEE_PROMPT } from './agents/hygienic.js';
// Micode agents
import { CODEBASE_LOCATOR_PROMPT } from './agents/codebase-locator.js';
import { CODEBASE_ANALYZER_PROMPT } from './agents/codebase-analyzer.js';
import { buildCustomSubagents } from './agents/custom-agents.js';
import { createBuiltinMcps } from './mcp/index.js';
import { crwMcp } from './mcp/crw.js';
import { ensureSnipInstalled, isSnipOnPath } from './utils/snip-installer.js';
import { ensureToolsInstalled, getHiveBinPath } from './utils/tool-installer.js';
// $ns Mode & Session Continuation hooks
import { createNsModeState, detectNsMode, getNsDirective } from './hooks/ns-mode.js';
import { createContinuationState, getPendingTaskCount, buildContinuationContext } from './hooks/session-continuation.js';

// ============================================================================
// Skill Tool - Uses generated registry (no file-based discovery)
// ============================================================================

function formatSkillsXml(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  const skillsXml = skills.map(skill => {
    return [
      '  <skill>',
      `    <name>${skill.name}</name>`,
      `    <description>(hive - Skill) ${skill.description}</description>`,
      '  </skill>',
    ].join('\n');
  }).join('\n');

  return `\n\n<available_skills>\n${skillsXml}\n</available_skills>`;
}

/**
 * Build auto-loaded skill templates for an agent.
 * Returns a string containing all skill templates to append to the agent's prompt.
 * 
 * Resolution order for each skill ID:
 * 1. Builtin skill (wins if exists)
 * 2. File-based skill (project OpenCode -> global OpenCode -> project Claude -> global Claude)
 * 3. Warn and skip if not found
 */
async function buildAutoLoadedSkillsContent(
  agentName: string,
  configService: ConfigService,
  projectRoot: string,
  autoLoadSkillsOverride?: string[],
): Promise<string> {
  const autoLoadSkills = autoLoadSkillsOverride ?? (configService.getAgentConfig(agentName).autoLoadSkills ?? []);

  if (autoLoadSkills.length === 0) {
    return '';
  }

  // Use process.env.HOME for testability, fallback to os.homedir()
  const homeDir = process.env.HOME || os.homedir();
  const skillTemplates: string[] = [];
  
  for (const skillId of autoLoadSkills) {
    // 1. Try builtin skill first (builtin wins)
    const builtinSkill = BUILTIN_SKILLS.find((entry) => entry.name === skillId);
    if (builtinSkill) {
      skillTemplates.push(builtinSkill.template);
      continue;
    }
    
    // 2. Fallback to file-based skill
    const fileResult = await loadFileSkill(skillId, projectRoot, homeDir);
    if (fileResult.found && fileResult.skill) {
      skillTemplates.push(fileResult.skill.template);
      continue;
    }
    
    // 3. Not found - warn and skip
    console.warn(`[hive] Unknown skill id "${skillId}" for agent "${agentName}"`);
  }

  if (skillTemplates.length === 0) {
    return '';
  }

  return '\n\n' + skillTemplates.join('\n\n');
}

function createHiveSkillTool(filteredSkills: SkillDefinition[]): ToolDefinition {
  const base = `Load a Hive skill to get detailed instructions for a specific workflow.

Use this when a task matches an available skill's description. The descriptions below ("Use when...", "Use before...") are triggers; when one applies, you MUST load that skill before proceeding.`;
  const description = filteredSkills.length === 0
    ? base + '\n\nNo Hive skills available.'
    : base + formatSkillsXml(filteredSkills);

  // Build a set of available skill names for validation
  const availableNames = new Set(filteredSkills.map(s => s.name));

  return tool({
    description,
    args: {
      name: tool.schema.string().describe('The skill name from available_skills'),
    },
    async execute({ name }) {
      // Check if skill is available (not filtered out)
      if (!availableNames.has(name)) {
        const available = filteredSkills.map(s => s.name).join(', ');
        throw new Error(`Skill "${name}" not available. Available Hive skills: ${available || 'none'}`);
      }

      const result = loadBuiltinSkill(name);

      if (!result.found || !result.skill) {
        const available = filteredSkills.map(s => s.name).join(', ');
        throw new Error(`Skill "${name}" not found. Available Hive skills: ${available || 'none'}`);
      }

      const skill = result.skill;
      return [
        `## Hive Skill: ${skill.name}`,
        '',
        `**Description**: ${skill.description}`,
        '',
        skill.template,
      ].join('\n');
    },
  });
}

// ============================================================================
import {
  WorktreeService,
  FeatureService,
  PlanService,
  TaskService,
  ContextService,
  ConfigService,
  AgentsMdService,
  DockerSandboxService,
  buildEffectiveDependencies,
  computeRunnableAndBlocked,
  detectContext,
  listFeatures,
  normalizePath,
  type WorktreeInfo,
} from "hive-core";
import { buildWorkerPrompt, type ContextFile, type CompletedTask } from "./utils/worker-prompt";
import { calculatePromptMeta, calculatePayloadMeta, checkWarnings } from "./utils/prompt-observability";
import { applyTaskBudget, applyContextBudget, DEFAULT_BUDGET, type TruncationEvent } from "./utils/prompt-budgeting";
import { writeWorkerPromptFile } from "./utils/prompt-file";
import { formatRelativeTime } from "./utils/format";
import { createVariantHook } from "./hooks/variant-hook.js";
import { HIVE_SYSTEM_PROMPT, shouldExecuteHook } from "./hooks/system-hook.js";
import {
  createLspDiagnosticsState,
  trackFileModification,
  runTypeScriptDiagnostics,
  resetDiagnostics,
  type LspDiagnosticsState,
} from "./hooks/lsp-diagnostics.js";
import { buildCompactionPrompt } from "./utils/compaction-prompt.js";
import { createCompactionHook, needsCompression, compressContext, buildCompressionHint } from "./utils/context-compression.js";
import { getDelegationHints } from "./utils/delegation-hints.js";

/**
 * Core plugin implementation.
 */
type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

// ============================================================================
// Snip Integration
// Prefix shell commands with snip to reduce 60-90% token usage
// Snip: https://github.com/edouard-claude/snip
// ============================================================================

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^\s]* +)*/;

/**
 * Prefix a command with snip to reduce output token usage
 */
function prefixWithSnip(command: string, snipCommand = 'snip'): string {
  // Don't double-prefix already snipped commands
  if (command.startsWith(`${snipCommand} `)) {
    return command;
  }

  // Split at first shell operator (space + && | ; | |), keeping operator+rest intact
  const splitMatch = command.match(/^(.*?)( &&| [|]| ;|;)(.*)$/);
  const firstPart = splitMatch ? splitMatch[1] : command;
  const rest = splitMatch ? splitMatch[2] + splitMatch[3] : '';

  // Extract leading env var prefix (e.g. "CGO_ENABLED=0 GOOS=linux ")
  const envPrefix = (firstPart.match(ENV_VAR_RE) ?? [''])[0];
  const bareCmd = firstPart.slice(envPrefix.length).trim();

  return `${envPrefix}${snipCommand} ${bareCmd}${rest}`;
}

// Auto-install snip + tools on plugin load (fire-and-forget, completes before first hook fires)
const snipBootPromise = ensureSnipInstalled();
const toolsBootPromise = ensureToolsInstalled();

// Proactively install LSP servers for common languages (fire-and-forget, non-blocking)
const lspBootPromise = ensureLspServers();

const plugin: Plugin = async (ctx) => {
  const { directory, client } = ctx;

  const featureService = new FeatureService(directory);
  const planService = new PlanService(directory);
  const taskService = new TaskService(directory);
  const contextService = new ContextService(directory);
  const agentsMdService = new AgentsMdService(directory, contextService);
  const configService = new ConfigService(); // User config at ~/.config/opencode/agent_hive.json
  const lspState: LspDiagnosticsState = createLspDiagnosticsState();
  // $ns mode state: activated on user "$ns" keyword, deactivated after injection
  const nsModeState = createNsModeState();
  // Session continuation state: prevents re-injection in the same compaction cycle
  const continuationState = createContinuationState();
  const disabledMcps = configService.getDisabledMcps();
  const disabledSkills = configService.getDisabledSkills();
  // Initialize vector memory sharding + quality from user config
  const vmConfig = configService.get().vectorMemory;
  if (vmConfig?.sharding) {
    setShardingConfig(vmConfig.sharding);
  }
  if (vmConfig?.quality) {
    setQualityConfig(vmConfig.quality);
  }
  // Initialize memory filter from user config
  const memoryFilterConfig = vmConfig?.memoryFilter;
  if (memoryFilterConfig !== undefined) {
    setVectorMemoryFilterConfig(memoryFilterConfig);
    setBlockMemoryFilterConfig(memoryFilterConfig);
  }
  const builtinMcps = createBuiltinMcps(disabledMcps);

  // CRW MCP: conditional — only activate when CRW backend URL is configured
  if (process.env.CRW_API_URL) {
    builtinMcps['crw'] = crwMcp;
  }

  // User profile service: lazily initialized when enabled
  let userProfileService: UserProfileService | null = null;
  const ensureUserProfile = (): UserProfileService | null => {
    const upConfig = configService.get().userProfile;
    if (!upConfig?.enabled) return null;
    if (!userProfileService) {
      try {
        const provider = new OpenCodeProviderService(client);
        userProfileService = new UserProfileService(upConfig, provider, directory);
      } catch {
        console.warn('[user-profile] Failed to initialize');
        return null;
      }
    }
    return userProfileService;
  };
  
  // Get filtered skills (globally disabled skills removed)
  // Per-agent skill filtering could be added here based on agent context
  const filteredSkills = getFilteredSkills(disabledSkills);
  const effectiveAutoLoadSkills = configService.getAgentConfig('zetta').autoLoadSkills ?? [];
  const worktreeService = new WorktreeService({
    baseDir: directory,
    hiveDir: path.join(directory, '.hive'),
  });

  /**
   * Check if OMO-Slim delegation is enabled via user config.
   * Users enable this in ~/.config/opencode/agent_hive.json
   */
  const isOmoSlimEnabled = (): boolean => {
    return configService.isOmoSlimEnabled();
  };

  const resolveFeature = (explicit?: string): string | null => {
    if (explicit) return explicit;

    const context = detectContext(directory);
    if (context.feature) return context.feature;

    const features = listFeatures(directory);
    if (features.length === 1) return features[0];

    return null;
  };

  const captureSession = (feature: string, toolContext: unknown) => {
    const ctx = toolContext as ToolContext;
    if (ctx?.sessionID) {
      const currentSession = featureService.getSession(feature);
      if (currentSession !== ctx.sessionID) {
        featureService.setSession(feature, ctx.sessionID);
      }
    }
  };

  /**
   * Check if a feature is blocked by the Beekeeper.
   * Returns the block message if blocked, null otherwise.
   * 
   * File protocol: .hive/features/<name>/BLOCKED
   * - If file exists, feature is blocked
   * - File contents = reason for blocking
   */
  const checkBlocked = (feature: string): string | null => {
    const fs = require('fs');
    const blockedPath = path.join(directory, '.hive', 'features', feature, 'BLOCKED');
    if (fs.existsSync(blockedPath)) {
      const reason = fs.readFileSync(blockedPath, 'utf-8').trim();
      return `⛔ BLOCKED by Beekeeper

${reason || '(No reason provided)'}

The human has blocked this feature. Wait for them to unblock it.
To unblock: Remove .hive/features/${feature}/BLOCKED`;
    }
    return null;
  };

  // ============================================================================
  // Hook Cadence Management
  // ============================================================================
  
  /**
   * Turn counters for hook cadence management.
   * Each hook tracks its own invocation count to determine when to fire.
   */
  const turnCounters: Record<string, number> = {};

  const checkDependencies = (feature: string, taskFolder: string): { allowed: boolean; error?: string } => {
    const taskStatus = taskService.getRawStatus(feature, taskFolder);
    if (!taskStatus) {
      return { allowed: true };
    }

    const tasks = taskService.list(feature).map(task => {
      const status = taskService.getRawStatus(feature, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: status?.dependsOn,
      };
    });

    const effectiveDeps = buildEffectiveDependencies(tasks);
    const deps = effectiveDeps.get(taskFolder) ?? [];

    if (deps.length === 0) {
      return { allowed: true };
    }

    const unmetDeps: Array<{ folder: string; status: string }> = [];

    for (const depFolder of deps) {
      const depStatus = taskService.getRawStatus(feature, depFolder);

      if (!depStatus || depStatus.status !== 'done') {
        unmetDeps.push({
          folder: depFolder,
          status: depStatus?.status ?? 'unknown',
        });
      }
    }

    if (unmetDeps.length > 0) {
      const depList = unmetDeps
        .map(d => `"${d.folder}" (${d.status})`)
        .join(', ');

      return {
        allowed: false,
        error: `Dependency constraint: Task "${taskFolder}" cannot start - dependencies not done: ${depList}. ` +
          `Only tasks with status 'done' satisfy dependencies.`,
      };
    }

    return { allowed: true };
  };

  const respond = (payload: Record<string, unknown>) => JSON.stringify(payload, null, 2);

  const buildWorktreeLaunchResponse = async ({
    feature,
    task,
    taskInfo,
    worktree,
    continueFrom,
    decision,
  }: {
    feature: string;
    task: string;
    taskInfo: NonNullable<ReturnType<typeof taskService.get>>;
    worktree: WorktreeInfo;
    continueFrom?: 'blocked';
    decision?: string;
  }) => {
    taskService.update(feature, task, {
      status: 'in_progress',
      baseCommit: worktree.commit,
    });

    const planResult = planService.read(feature);
    const allTasks = taskService.list(feature);

    // Build dependencies for delegation hints
    const tasksForDeps = allTasks.map(t => {
      const status = taskService.getRawStatus(feature, t.folder);
      return {
        folder: t.folder,
        status: t.status,
        dependsOn: status?.dependsOn,
      };
    });
    const effectiveDeps = buildEffectiveDependencies(tasksForDeps);

    const rawContextFiles = contextService.list(feature).map(f => ({
      name: f.name,
      content: f.content,
    }));

    const rawPreviousTasks = allTasks
      .filter(t => t.status === 'done' && t.summary)
      .map(t => ({ name: t.folder, summary: t.summary! }));

    const taskBudgetResult = applyTaskBudget(rawPreviousTasks, { ...DEFAULT_BUDGET, feature });
    const contextBudgetResult = applyContextBudget(rawContextFiles, { ...DEFAULT_BUDGET, feature });

    const contextFiles: ContextFile[] = contextBudgetResult.files.map(f => ({
      name: f.name,
      content: f.content,
    }));
    const previousTasks: CompletedTask[] = taskBudgetResult.tasks.map(t => ({
      name: t.name,
      summary: t.summary,
    }));

    const truncationEvents: TruncationEvent[] = [
      ...taskBudgetResult.truncationEvents,
      ...contextBudgetResult.truncationEvents,
    ];

    const droppedTasksHint = taskBudgetResult.droppedTasksHint;

    const taskOrder = parseInt(taskInfo.folder.match(/^(\d+)/)?.[1] || '0', 10);
    const status = taskService.getRawStatus(feature, task);
    const dependsOn = status?.dependsOn ?? [];
    const specContent = taskService.buildSpecContent({
      featureName: feature,
      task: {
        folder: task,
        name: taskInfo.planTitle ?? taskInfo.name,
        order: taskOrder,
        description: undefined,
      },
      dependsOn,
      allTasks: allTasks.map(t => ({
        folder: t.folder,
        name: t.name,
        order: parseInt(t.folder.match(/^(\d+)/)?.[1] || '0', 10),
      })),
      planContent: planResult?.content ?? null,
      contextFiles,
      completedTasks: previousTasks,
    });

    taskService.writeSpec(feature, task, specContent);

    const workerPrompt = buildWorkerPrompt({
      feature,
      task,
      taskOrder,
      worktreePath: worktree.path,
      branch: worktree.branch,
      plan: planResult?.content || 'No plan available',
      contextFiles,
      spec: specContent,
      previousTasks,
      continueFrom: continueFrom === 'blocked' ? {
        status: 'blocked',
        previousSummary: (taskInfo as any).summary || 'No previous summary',
        decision: decision || 'No decision provided',
      } : undefined,
    });

    const customAgentConfigs = configService.getCustomAgentConfigs();
    const defaultAgent = 'forager-worker';
    const eligibleAgents = [
      {
        name: defaultAgent,
        baseAgent: defaultAgent,
        description: 'Default implementation worker',
      },
      ...Object.entries(customAgentConfigs)
        .filter(([, config]) => config.baseAgent === 'forager-worker')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, config]) => ({
          name,
          baseAgent: config.baseAgent,
          description: config.description,
        })),
    ];
    const agent = defaultAgent;

    const rawStatus = taskService.getRawStatus(feature, task);
    const attempt = (rawStatus?.workerSession?.attempt || 0) + 1;
    const idempotencyKey = `hive-${feature}-${task}-${attempt}`;

    taskService.patchBackgroundFields(feature, task, { idempotencyKey });

    const contextContent = contextFiles.map(f => f.content).join('\n\n');
    const previousTasksContent = previousTasks.map(t => `- **${t.name}**: ${t.summary}`).join('\n');
    const promptMeta = calculatePromptMeta({
      plan: planResult?.content || '',
      context: contextContent,
      previousTasks: previousTasksContent,
      spec: specContent,
      workerPrompt,
    });

    const hiveDir = path.join(directory, '.hive');
    const workerPromptPath = writeWorkerPromptFile(feature, task, workerPrompt, hiveDir);
    const relativePromptPath = normalizePath(path.relative(directory, workerPromptPath));

    const PREVIEW_MAX_LENGTH = 200;
    const workerPromptPreview = workerPrompt.length > PREVIEW_MAX_LENGTH
      ? workerPrompt.slice(0, PREVIEW_MAX_LENGTH) + '...'
      : workerPrompt;

    const taskToolPrompt = `Follow instructions in @${relativePromptPath}`;

    const taskToolInstructions = `## Delegation Required

Choose one of the eligible forager-derived agents below.
Default to \`${defaultAgent}\` if no specialist is a better match.

${eligibleAgents.map((candidate) => `- \`${candidate.name}\` — ${candidate.description}`).join('\n')}

Use OpenCode's built-in \`task\` tool with the chosen \`subagent_type\` and the provided \`taskToolCall.prompt\` value.
\`taskToolCall.subagent_type\` is prefilled with the default for convenience; override it when a specialist in \`eligibleAgents\` is a better match.

\`\`\`
task({
  subagent_type: "<chosen-agent>",
  description: "Hive: ${task}",
  prompt: "${taskToolPrompt}"
})
\`\`\`

Use the \`@path\` attachment syntax in the prompt to reference the file. Do not inline the file contents.

`;

    const responseBase = {
      success: true,
      terminal: false,
      worktreePath: worktree.path,
      branch: worktree.branch,
      mode: 'delegate',
      agent,
      defaultAgent,
      eligibleAgents,
      delegationRequired: true,
      workerPromptPath: relativePromptPath,
      workerPromptPreview,
      taskPromptMode: 'opencode-at-file',
      taskToolCall: {
        subagent_type: agent,
        description: `Hive: ${task}`,
        prompt: taskToolPrompt,
      },
      instructions: taskToolInstructions,
    };

    const jsonPayload = JSON.stringify(responseBase, null, 2);
    const payloadMeta = calculatePayloadMeta({
      jsonPayload,
      promptInlined: false,
      promptReferencedByFile: true,
    });

    const sizeWarnings = checkWarnings(promptMeta, payloadMeta);
    const budgetWarnings = truncationEvents.map(event => ({
      type: event.type as string,
      severity: 'info' as const,
      message: event.message,
      affected: event.affected,
      count: event.count,
    }));
    const allWarnings = [...sizeWarnings, ...budgetWarnings];

    // Get delegation hints
    const delegationHints = getDelegationHints(
      taskInfo.name,
      taskInfo.planTitle,
      allTasks,
      effectiveDeps
    );

    return respond({
      ...responseBase,
      promptMeta,
      payloadMeta,
      budgetApplied: {
        maxTasks: DEFAULT_BUDGET.maxTasks,
        maxSummaryChars: DEFAULT_BUDGET.maxSummaryChars,
        maxContextChars: DEFAULT_BUDGET.maxContextChars,
        maxTotalContextChars: DEFAULT_BUDGET.maxTotalContextChars,
        tasksIncluded: previousTasks.length,
        tasksDropped: rawPreviousTasks.length - previousTasks.length,
        droppedTasksHint,
      },
      delegationHints,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    });
  };

  const executeWorktreeStart = async ({
    task,
    feature: explicitFeature,
  }: {
    task: string;
    feature?: string;
  }) => {
    const feature = resolveFeature(explicitFeature);
    if (!feature) {
      return respond({
        success: false,
        terminal: true,
        error: 'No feature specified. Create a feature or provide feature param.',
        reason: 'feature_required',
        task,
        hints: [
          'Create/select a feature first or pass the feature parameter explicitly.',
          'Use hive_status to inspect the active feature state before retrying.',
        ],
      });
    }

    const blockedMessage = checkBlocked(feature);
    if (blockedMessage) {
      return respond({
        success: false,
        terminal: true,
        error: blockedMessage,
        reason: 'feature_blocked',
        feature,
        task,
        hints: [
          'Wait for the human to unblock the feature before retrying.',
          `If approved, remove .hive/features/${feature}/BLOCKED and retry hive_worktree_start.`,
        ],
      });
    }

    const taskInfo = taskService.get(feature, task);
    if (!taskInfo) {
      return respond({
        success: false,
        terminal: true,
        error: `Task "${task}" not found`,
        reason: 'task_not_found',
        feature,
        task,
        hints: [
          'Check the task folder name in tasks.json or hive_status output.',
          'Run hive_tasks_sync if the approved plan has changed and tasks need regeneration.',
        ],
      });
    }

    if (taskInfo.status === 'done') {
      return respond({
        success: false,
        terminal: true,
        error: `Task "${task}" is already completed (status: done). It cannot be restarted.`,
        currentStatus: 'done',
        hints: [
          'Use hive_merge to integrate the completed task branch if not already merged.',
          'Use hive_status to see all task states and find the next runnable task.',
        ],
      });
    }

    if (taskInfo.status === 'blocked') {
      return respond({
        success: false,
        terminal: true,
        error: `Task "${task}" is blocked and must be resumed with hive_worktree_create using continueFrom: 'blocked'.`,
        currentStatus: 'blocked',
        feature,
        task,
        hints: [
          'Ask the user the blocker question, then call hive_worktree_create({ task, continueFrom: "blocked", decision }).',
          'Use hive_status to inspect blocker details before retrying.',
        ],
      });
    }

    const depCheck = checkDependencies(feature, task);
    if (!depCheck.allowed) {
      return respond({
        success: false,
        terminal: true,
        reason: 'dependencies_not_done',
        feature,
        task,
        error: depCheck.error,
        hints: [
          'Complete the required dependencies before starting this task.',
          'Use hive_status to see current task states.',
        ],
      });
    }

    const worktree = await worktreeService.create(feature, task);
    return buildWorktreeLaunchResponse({ feature, task, taskInfo, worktree });
  };

  const executeBlockedResume = async ({
    task,
    feature: explicitFeature,
    continueFrom,
    decision,
  }: {
    task: string;
    feature?: string;
    continueFrom?: 'blocked';
    decision?: string;
  }) => {
    const feature = resolveFeature(explicitFeature);
    if (!feature) {
      return respond({
        success: false,
        terminal: true,
        error: 'No feature specified. Create a feature or provide feature param.',
        reason: 'feature_required',
        task,
        hints: [
          'Create/select a feature first or pass the feature parameter explicitly.',
          'Use hive_status to inspect the active feature state before retrying.',
        ],
      });
    }

    const blockedMessage = checkBlocked(feature);
    if (blockedMessage) {
      return respond({
        success: false,
        terminal: true,
        error: blockedMessage,
        reason: 'feature_blocked',
        feature,
        task,
        hints: [
          'Wait for the human to unblock the feature before retrying.',
          `If approved, remove .hive/features/${feature}/BLOCKED and retry hive_worktree_create.`,
        ],
      });
    }

    const taskInfo = taskService.get(feature, task);
    if (!taskInfo) {
      return respond({
        success: false,
        terminal: true,
        error: `Task "${task}" not found`,
        reason: 'task_not_found',
        feature,
        task,
        hints: [
          'Check the task folder name in tasks.json or hive_status output.',
          'Run hive_tasks_sync if the approved plan has changed and tasks need regeneration.',
        ],
      });
    }

    if (taskInfo.status === 'done') {
      return respond({
        success: false,
        terminal: true,
        error: `Task "${task}" is already completed (status: done). It cannot be restarted.`,
        currentStatus: 'done',
        hints: [
          'Use hive_merge to integrate the completed task branch if not already merged.',
          'Use hive_status to see all task states and find the next runnable task.',
        ],
      });
    }

    if (continueFrom !== 'blocked') {
      return respond({
        success: false,
        terminal: true,
        error: 'hive_worktree_create is only for resuming blocked tasks.',
        reason: 'blocked_resume_required',
        currentStatus: taskInfo.status,
        feature,
        task,
        hints: [
          'Use hive_worktree_start({ feature, task }) to start a pending or in-progress task normally.',
          'Use hive_worktree_create({ task, continueFrom: "blocked", decision }) only after hive_status confirms the task is blocked.',
        ],
      });
    }

    if (taskInfo.status !== 'blocked') {
      return respond({
        success: false,
        terminal: true,
        error: `continueFrom: 'blocked' was specified but task "${task}" is not in blocked state (current status: ${taskInfo.status}).`,
        currentStatus: taskInfo.status,
        hints: [
          'Use hive_worktree_start({ feature, task }) for normal starts or re-dispatch.',
          'Use hive_status to verify the current task status before retrying.',
        ],
      });
    }

    const worktree = await worktreeService.get(feature, task);
    if (!worktree) {
      return respond({
        success: false,
        terminal: true,
        error: `Cannot resume blocked task "${task}": no existing worktree record found.`,
        currentStatus: taskInfo.status,
        hints: [
          'The worktree may have been removed manually. Use hive_worktree_discard to reset the task to pending, then restart it with hive_worktree_start.',
          'Use hive_status to inspect the current state of the task and its worktree.',
        ],
      });
    }

    return buildWorktreeLaunchResponse({
      feature,
      task,
      taskInfo,
      worktree,
      continueFrom,
      decision,
    });
  };

  return {
    "experimental.chat.system.transform": safeHook(
      'experimental.chat.system.transform',
      async (input: { agent?: string } | unknown, output: { system: string[] }) => {
        // Cadence gate: check if this hook should execute this turn
        if (!shouldExecuteHook("experimental.chat.system.transform", configService, turnCounters)) {
          return;
        }

        output.system.push(HIVE_SYSTEM_PROMPT);

        // Inject memory blocks into system prompt
        try {
          const memoryInjection = await buildMemoryInjection(directory);
          if (memoryInjection) {
            output.system.push(memoryInjection);
          }
        } catch {
          // 0-risk: memory injection failure
        }

        // Auto-recall: inject recent vector memories (configurable via vectorMemory.autoRecall)
        const autoRecallConfig = configService.get().vectorMemory?.autoRecall;
        if (autoRecallConfig?.enabled !== false) {
          try {
            const maxMemories = autoRecallConfig?.maxMemories ?? 5;
            const typeFilter = autoRecallConfig?.types;
            const scopeFilter = autoRecallConfig?.scope;

            const listOptions: { limit: number; type?: string; scope?: string } = { limit: maxMemories };
            if (typeFilter && typeFilter.length > 0) {
              listOptions.type = typeFilter[0];
            }
            if (scopeFilter) {
              listOptions.scope = scopeFilter;
            }

            const { results } = await listMemories(listOptions);
            if (results && results.length > 0) {
              const formatted = formatAutoRecallInjection(results, 300);
              if (formatted) {
                output.system.push('\n' + formatted);
              }
            }
          } catch (error) {
            console.warn('[auto-recall] Failed to inject vector memories:', error instanceof Error ? error.message : error);
          }
        }

        const activeFeature = resolveFeature();
        if (activeFeature) {
          try {
            const info = featureService.getInfo(activeFeature);
            if (info) {
              let statusHint = `\n### Current Hive Status\n`;
              statusHint += `**Active Feature**: ${info.name} (${info.status})\n`;
              statusHint += `**Progress**: ${info.tasks.filter(t => t.status === 'done').length}/${info.tasks.length} tasks\n`;

              if (info.commentCount > 0) {
                statusHint += `**Comments**: ${info.commentCount} unresolved - address with hive_plan_read\n`;
              }

              output.system.push(statusHint);
            }
          } catch {
            // 0-risk: feature status injection failure
          }
        }

        // User profile: inject learned preferences into system prompt (opt-in)
        try {
          const upService = ensureUserProfile();
          if (upService) {
            const profileInjection = upService.getProfileInjection();
            if (profileInjection) {
              output.system.push('\n### User Profile (Learned Preferences)\n' + profileInjection);
            }
          }
        } catch {
          // 0-risk: best-effort injection
        }

        // LSP Auto-Diagnostics: inject TypeScript diagnostics for recently
        // edited files so the agent sees type errors without asking.
        try {
          const diagBlock = runTypeScriptDiagnostics(lspState, directory);
          if (diagBlock) {
            output.system.push(diagBlock);
          }
        } catch {
          // 0-risk: diagnostics failure should not block the chat
        }

        // $ns mode: inject directive if active (one-shot per trigger)
        try {
          if (nsModeState.active) {
            const directive = getNsDirective();
            if (directive) {
              output.system.push(directive);
            }
            nsModeState.deactivate();
          }
        } catch {
          // 0-risk: directive injection failure
        }

        // Session continuation: inject continuation directive when tasks remain
        try {
          if (continuationState.injected) {
            const { feature, pending, nextTask } = getPendingTaskCount(directory);
            if (feature && pending.length > 0) {
              output.system.push(`\n## Session Continuation\nContinue working on feature "${feature}". ${pending.length} task(s) remaining. Next: "${nextTask?.name ?? 'check hive_status'}"`);
            }
          }
        } catch {
          // 0-risk: continuation injection failure
        }

        // Reset continuation state on each system transform cycle
        try {
          continuationState.reset();
        } catch {
          // 0-risk
        }
      },
    ),

    // Context compression hook - auto compresses at 50% context threshold
    // Similar to DCP (Dynamic Context Pruning) or oh-my-openagent
    // Also captures session snapshot for continuity
    "experimental.session.compacting": safeHook(
      'experimental.session.compacting',
      async (
        input: { sessionID: string; messages?: unknown[]; contextLimit?: number },
        output: { context: string[]; prompt?: string },
      ) => {
      // Get config
      const snapshotConfig = configService.get().sessionSnapshot;
      const compressionConfig = configService.get().contextCompression;
      
      // Session snapshot - capture state before compaction
      if (snapshotConfig?.enabled !== false) {
        const snapshotParts: string[] = [];
        const maxChars = snapshotConfig?.maxSnapshotChars ?? 2048;
        
        // Active feature
        if (snapshotConfig?.includeActiveFeature !== false) {
          try {
            const active = featureService.getActive();
            if (active) {
              snapshotParts.push(`## Active Feature: ${active.name}`);
              snapshotParts.push(`Status: ${active.status}`);
            }
          } catch {
            // Feature service might not be available
          }
        }
        
        // Pending tasks
        if (snapshotConfig?.includePendingTasks !== false) {
          try {
            const featureNames = featureService.list();
            const pendingTasks: string[] = [];
            
            for (const name of featureNames) {
              const info = featureService.getInfo(name);
              if (info && info.status !== 'completed') {
                const pending = info.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
                for (const task of pending) {
                  pendingTasks.push(`- [${task.status}] ${task.name}`);
                }
              }
            }
            
            if (pendingTasks.length > 0) {
              snapshotParts.push(`\n## Pending Tasks (${pendingTasks.length})`);
              snapshotParts.push(...pendingTasks.slice(0, 20));
            }
          } catch {
            // Task service might not be available
          }
        }
        
        if (snapshotParts.length > 0) {
          const snapshot = snapshotParts.join('\n').slice(0, maxChars);
          output.context.push(`
## Session Snapshot (before compaction)

${snapshot}

**Important:** After compaction, resume from where you left off. Check the pending tasks above and continue working.
`);
        }
      }
      
      // Context compression
      const contextLimit = input.contextLimit || 200000;
      const messages = (input.messages || []) as Array<{ role?: string; content?: unknown; tool_calls?: unknown[] }>;
      
      if (messages.length > 0) {
        const { needsCompression, compressContext, buildCompressionHint } = await import("./utils/context-compression.js");
        
        const threshold = compressionConfig?.threshold ?? 0.5;
        const enabled = compressionConfig?.enabled ?? true;
        
        if (needsCompression(messages as any, contextLimit, { threshold, enabled })) {
          const { stats } = compressContext(messages as any, { 
            threshold, 
            enabled,
            maxToolCalls: compressionConfig?.maxToolCalls ?? 50,
            protectedTools: compressionConfig?.protectedTools ?? [
              "hive_feature_create",
              "hive_plan_write",
              "hive_worktree_commit", 
              "hive_merge",
            ],
          }, contextLimit);
          
          console.log(`[hive:compaction] Context at ${Math.round(stats.reductionRatio * 100)}% - compressed ${stats.originalMessages} → ${stats.compressedMessages} messages`);
          
          output.context.push(buildCompressionHint());
        } else {
          output.context.push(buildCompactionPrompt());
        }
      } else {
        output.context.push(buildCompactionPrompt());
      }

      // Auto-capture: save session snapshot as vector memory (zero-API-call pattern)
      // This ensures key context survives compaction in searchable form.
      // No extra API calls — piggybacks on the compaction event that's already firing.
      // Supports two modes: "manual" (existing flow) and "opencode" (uses session.prompt for structured content)
      const autoCaptureConfig = configService.get().vectorMemory?.autoCapture;
      if (autoCaptureConfig?.enabled !== false) {
        try {
          const active = featureService.getActive();
          if (active) {
            const info = featureService.getInfo(active.name);
            if (info) {
              const captureType = autoCaptureConfig?.type || 'context';
              const pendingTasks = autoCaptureConfig?.includePendingTasks !== false
                ? info.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').map(t => t.name)
                : undefined;
              const doneCount = info.tasks.filter(t => t.status === 'done').length;
              const snapshotContent = buildCaptureSnapshot(
                info.name,
                info.status,
                doneCount,
                info.tasks.length,
                pendingTasks,
              );

              // Check provider mode: "opencode" uses session.prompt for structured capture
              const providerMode = autoCaptureConfig?.provider?.mode ?? 'manual';
              let contentToSave = snapshotContent;

              if (providerMode === 'opencode' && client) {
                try {
                  const provider = new OpenCodeProviderService(client);
                  const structured = await provider.captureStructuredMemory(snapshotContent);
                  if (structured) {
                    contentToSave = structured;
                  }
                  // If opencode provider fails, skip — don't fall back to manual
                  // This maintains 0-risk: output only shrinks, never grows
                } catch (providerError) {
                  console.warn(
                    '[auto-capture] OpenCode provider capture failed, skipping:',
                    providerError instanceof Error ? providerError.message : providerError,
                  );
                  return; // Skip entirely if opencode provider fails
                }
              }

              await addMemory(contentToSave, {
                type: captureType as any,
                scope: info.name,
                tags: ['auto-capture', 'session-snapshot'],
                source: 'compaction-hook',
              });
            }
          }
        } catch (error) {
          // Silently fail - auto-capture is best-effort
          console.warn('[auto-capture] Failed to save session snapshot:', error instanceof Error ? error.message : error);
        }
      }

      // Compaction restoration: re-inject memories after compact (fire-and-forget)
      // Pattern from opencode-mem — ensures memories survive compaction
      // 0-risk: never blocks compaction, always catches errors
      const crConfig = configService.get().vectorMemory?.compactionRestoration;
      if (crConfig?.enabled !== false && client) {
        reInjectMemoriesAfterCompact(input.sessionID, client, crConfig)
          .catch((err: unknown) => {
            console.warn('[compaction-restoration] Unexpected error:', err instanceof Error ? err.message : err);
          });
      }

      // Auto-save to project.md: append session context for cross-session persistence
      const autoSaveConfig = configService.get().vectorMemory?.autoSaveProject;
      // Reset LSP diagnostics state on compaction so we don't re-check
      // stale files after context is compressed.
      resetDiagnostics(lspState);

      if (autoSaveConfig?.enabled !== false) {
        try {
          const active = featureService.getActive();
          if (active) {
            const info = featureService.getInfo(active.name);
            if (info) {
              const maxEntries = autoSaveConfig?.maxEntries ?? 20;
              const projectMdPath = path.join(directory, '.hive', 'memory', 'project', 'project.md');

              // Read current content (if exists)
              let currentBody = '';
              if (fs.existsSync(projectMdPath)) {
                const raw = fs.readFileSync(projectMdPath, 'utf-8');
                // Strip YAML frontmatter
                const bodyMatch = raw.match(/^---[\s\S]*?---\n([\s\S]*)$/);
                currentBody = bodyMatch ? bodyMatch[1].trim() : raw.trim();
              }

              // Build new entry
              const doneCount = info.tasks.filter(t => t.status === 'done').length;
              const pendingNames = info.tasks
                .filter(t => t.status === 'pending' || t.status === 'in_progress')
                .map(t => t.name);
              const entry = [
                `[${new Date().toISOString().slice(0, 10)}] Feature: ${info.name} (${info.status})`,
                `  Tasks: ${doneCount}/${info.tasks.length} completed`,
                pendingNames.length > 0 ? `  Pending: ${pendingNames.join(', ')}` : '',
                '',
              ].filter(Boolean).join('\n');

              // Prepend new entry, keep under maxEntries
              const existingEntries = currentBody ? currentBody.split('\n\n') : [];
              const allEntries = [entry.trim(), ...existingEntries].slice(0, maxEntries);
              const newBody = allEntries.join('\n\n') + '\n';

              // Write with frontmatter
              const frontmatter = [
                '---',
                'label: project',
                `description: Project-specific knowledge: commands, architecture, conventions, gotchas.`,
                'limit: 5000',
                'read_only: false',
                '---',
                '',
              ].join('\n');

              fs.mkdirSync(path.dirname(projectMdPath), { recursive: true });
              fs.writeFileSync(projectMdPath, frontmatter + newBody, 'utf-8');
            }
          }
        } catch (error) {
          console.warn('[auto-save-project] Failed to update project.md:', error instanceof Error ? error.message : error);
        }

        // Session continuation: check for remaining tasks on compaction
        // Injects context so the agent auto-continues instead of stopping.
        try {
          if (!continuationState.injected) {
            const { feature, pending, nextTask } = getPendingTaskCount(directory);
            if (feature && pending.length > 0) {
              const ctx = buildContinuationContext(feature, pending, nextTask);
              if (ctx) {
                output.context.push(ctx);
                continuationState.markInjected();
              }
            }
          }
        } catch {
          // 0-risk: continuation check failure
        }
      }
    }
    ),

    // Hidden-session judge: evaluate task completion after agent turns
    // Pattern from dzianisv/opencode-plugins — opt-in (consumes LLM tokens when enabled)
    // 0-risk: best-effort, never blocks the session, anti-recursion guard
    "session.idle": safeHook(
      'session.idle',
      async (input: { sessionID: string; messages?: unknown[] }, _output: unknown) => {
        const judgeConfig = configService.get().hiddenJudge;
        if (!judgeConfig?.enabled) return;

        // Anti-recursion: skip judge sessions
        if (input.sessionID?.startsWith('judge-')) return;

        try {
          // Build task context from recent messages
          const messages = (input.messages ?? []) as Array<{ role?: string; content?: string; tool_calls?: unknown[] }>;
          const lastMessage = messages
            .filter(m => m.role === 'assistant')
            .pop()?.content ?? '';

          // Count tool calls and write operations from recent messages
          const recentMessages = messages.slice(-20);
          let toolCalls = 0;
          let writeOps = 0;
          let consecutiveIdenticalCommands = 0;
          let lastCommand = '';

          for (const msg of recentMessages) {
            if (msg.role === 'assistant' && msg.tool_calls) {
              toolCalls += msg.tool_calls.length;
            }
            if (msg.content) {
              const isWriteTool = /write|edit|create|delete|rename|mkdir/i.test(msg.content);
              if (isWriteTool) writeOps++;

              const command = msg.content?.slice(0, 100);
              if (command === lastCommand) {
                consecutiveIdenticalCommands++;
              } else {
                consecutiveIdenticalCommands = 0;
                lastCommand = command;
              }
            }
          }

          const writeRatio = toolCalls > 0 ? writeOps / toolCalls : 0;

          const judge = new HiddenJudgeService(judgeConfig);

          // Fire-and-forget: never await on the idle path
          judge.evaluateAndFeedback({
            sessionId: input.sessionID,
            client,
            taskContext: {
              toolCalls,
              writeRatio,
              lastMessage,
              consecutiveIdenticalCommands,
            },
          }).catch((err: unknown) => {
            console.warn('[hidden-judge] Unexpected error:', err instanceof Error ? err.message : err);
          });
        } catch (error) {
          console.warn('[hidden-judge] Hook error:', error instanceof Error ? error.message : error);
        }
      },
    ),

    // Apply per-agent variant to messages (covers built-in and accepted custom task() agents)
    "chat.message": safeHook(
      'chat.message',
      async (input: any, output: any) => {
        // Apply variant hook
        try {
          await createVariantHook(configService)(input, output);
        } catch {
          // 0-risk: variant assignment failure
        }
        // User profile: track user messages (best-effort, 0-risk)
        try {
          const inputMsg = input?.message ?? input?.body ?? {};
          if (inputMsg.role === 'user') {
            const text = inputMsg.text ?? inputMsg.content ?? '';
            if (text) {
              const upService = ensureUserProfile();
              if (upService) {
                upService.onUserMessage(text).catch(() => {});
              }
            }
          }
        } catch {
          // 0-risk: never throw from hook
        }
        // $ns mode: detect keyword in user messages
        try {
          const inputMsg = input?.message ?? input?.body ?? {};
          if (inputMsg.role === 'user') {
            const text = inputMsg.text ?? inputMsg.content ?? '';
            if (text && typeof text === 'string' && detectNsMode(text)) {
              nsModeState.activate();
            }
          }
        } catch {
          // 0-risk: $ns detection failure
        }
      },
    ) as any,

    "tool.execute.before": safeHook(
      'tool.execute.before',
      async (input: { tool?: string; args?: Record<string, unknown> }, output: { args?: { command?: string; workdir?: string } }) => {
        // Cadence gate: check if this hook should execute this turn
        if (!shouldExecuteHook("tool.execute.before", configService, turnCounters, { safetyCritical: true })) {
          return;
        }

        if (input.tool !== "bash") return;
        
        const command = output.args?.command?.trim();
        if (!command) return;
        
        // Escape hatch: HOST: prefix (case-insensitive)
        if (/^HOST:\s*/i.test(command)) {
          const strippedCommand = command.replace(/^HOST:\s*/i, '');
          console.warn(`[hive:sandbox] HOST bypass: ${strippedCommand.slice(0, 80)}${strippedCommand.length > 80 ? '...' : ''}`);
          output.args.command = strippedCommand;
          return;
        }

        try {
          const snipConfig = configService.get().snip;
          const snipBinary = await snipBootPromise;
          const snipAvailable = snipBinary !== '';
          const isSnipEnabled = snipConfig?.enabled ?? snipAvailable;
          const snipCmd = snipConfig?.command || (snipBinary || 'snip');
          const hiveBinPath = getHiveBinPath();
          let finalCommand = command;
          if (isSnipEnabled && snipAvailable) {
            finalCommand = prefixWithSnip(command, snipCmd);
          }
          finalCommand = `PATH="${hiveBinPath}:$PATH" ${finalCommand}`;
          
          const sandboxConfig = configService.getSandboxConfig();
          if (sandboxConfig.mode !== 'none') {
            const workdir = output.args?.workdir;
            if (workdir) {
              const hiveWorktreeBase = path.join(directory, '.hive', '.worktrees');
              if (workdir.startsWith(hiveWorktreeBase)) {
                const wrapped = DockerSandboxService.wrapCommand(workdir, finalCommand, sandboxConfig);
                output.args.command = wrapped;
                output.args.workdir = undefined;
                return;
              }
            }
          }
          
          output.args.command = finalCommand;
        } catch {
          // 0-risk: if any processing fails, use the original command unchanged
          output.args.command = command;
        }
      },
    ),

    // LSP file tracking + token truncation hook
    "tool.execute.after": safeHook(
      'tool.execute.after',
      async (input: { tool: string; sessionID: string; callID: string; args: any }, output: { title: string; output: string; metadata: any }) => {
        // Track files modified by Write/Edit tools for LSP auto-diagnostics
        trackFileModification(lspState, input.tool, input.args);

        const truncationConfig = configService.get().tokenTruncation;
        if (!truncationConfig?.enabled) return;
        
        const result = output.output;
        if (!result) return;
        
        const maxChars = truncationConfig.maxChars ?? 30000;
        if (result.length <= maxChars) return;
        
        const keepFirst = truncationConfig.keepFirstPercent ?? 40;
        const keepLast = truncationConfig.keepLastPercent ?? 40;
        
        const firstChars = Math.floor((result.length * keepFirst) / 100);
        const lastChars = Math.floor((result.length * keepLast) / 100);
        
        const truncated = result.slice(0, firstChars) + 
          `\n\n[... ${result.length - firstChars - lastChars} characters truncated ...]\n\n` + 
          result.slice(-lastChars);
        
        output.output = truncated;
      },
    ),

    tool: {
      look_at: lookAtTool,
      artifact_search: artifactSearchTool,
      btca_ask: btcaAskTool,
      pty_start: ptyStartTool,
      pty_send: ptySendTool,
      pty_read: ptyReadTool,
      pty_kill: ptyKillTool,
      pty_list: ptyListTool,

      // LSP Tools - IDE-like functionality (with auto-install)
      lsp_rename: lspRenameTool,
      lsp_goto_definition: lspGotoDefinitionTool,
      lsp_find_references: lspFindReferencesTool,
      lsp_diagnostics: lspDiagnosticsTool,
      lsp_hover: lspHoverTool,
      lsp_code_actions: lspCodeActionsTool,
      lsp_status: lspStatusTool,
      lsp_install: lspInstallTool,

      // Skill-Embedded MCP Tools
      skill_mcp: skillMcpTool,
      list_skill_mcps: listSkillMcpsTool,

      // Memory Tools (Letta-style persistent memory blocks)
      hive_memory_list: hiveMemoryListTool,
      hive_memory_set: hiveMemorySetTool,
      hive_memory_replace: hiveMemoryReplaceTool,
      // Typed memory tools (from simple-memory)
      hive_memory_recall: hiveMemoryRecallTool,
      hive_memory_update: hiveMemoryUpdateTool,
      hive_memory_forget: hiveMemoryForgetTool,
      // Journal tools
      hive_journal_write: hiveJournalWriteTool,
      hive_journal_search: hiveJournalSearchTool,

      // Agent Booster Tools (ultra-fast code editing, 52x faster)
      hive_code_edit: hiveCodeEditTool,
      hive_lazy_edit: hiveLazyEditTool,
      hive_booster_status: hiveBoosterStatusTool,

      // Vector Memory Tools (semantic search with HNSW)
      hive_vector_search: hiveVectorSearchTool,
      hive_vector_add: hiveVectorAddTool,
      hive_vector_status: hiveVectorStatusTool,

      // Dora CLI Tools (SCIP-based code navigation)
      dora_status: doraStatusTool,
      dora_symbol: doraSymbolTool,
      dora_file: doraFileTool,
      dora_references: doraReferencesTool,
      dora_cycles: doraCyclesTool,
      dora_unused: doraUnusedTool,

      // Auto-CR Tools (SWC-based code review)
      auto_cr_status: autoCrStatusTool,
      auto_cr_scan: autoCrScanTool,
      auto_cr_diff: autoCrDiffTool,
      auto_cr_rules: autoCrRulesTool,

      // Directory Explorer Tool
      explore_directory: exploreDirectoryTool,

      hive_skill: createHiveSkillTool(filteredSkills),

      hive_feature_create: tool({
        description: 'Create a new feature and set it as active',
        args: {
          name: tool.schema.string().describe('Feature name'),
          ticket: tool.schema.string().optional().describe('Ticket reference'),
        },
        async execute({ name, ticket }) {
          const feature = featureService.create(name, ticket);
          return `Feature "${name}" created.

## Discovery Phase Required

Before writing a plan, you MUST:
1. Ask clarifying questions about the feature
2. Document Q&A in plan.md with a \`## Discovery\` section
3. Research the codebase (grep, read existing code)
4. Save findings with hive_context_write

Example discovery section:
\`\`\`markdown
## Discovery

**Q: What authentication system do we use?**
A: JWT with refresh tokens, see src/auth/

**Q: Should this work offline?**
A: No, online-only is fine

**Research:**
- Found existing theme system in src/theme/
- Uses CSS variables pattern
\`\`\`

## Planning Guidelines

When writing your plan, include:
- \`## Non-Goals\` - What we're explicitly NOT building (scope boundaries)
- \`## Ghost Diffs\` - Alternatives you considered but rejected

These prevent scope creep and re-proposing rejected solutions.

NEXT: Ask your first clarifying question about this feature.`;
        },
      }),

      hive_feature_complete: tool({
        description: 'Mark feature as completed (irreversible)',
        args: { name: tool.schema.string().optional().describe('Feature name (defaults to active)') },
        async execute({ name }) {
          const feature = resolveFeature(name);
          if (!feature) return "Error: No feature specified. Create a feature or provide name.";
          featureService.complete(feature);
          return `Feature "${feature}" marked as completed`;
        },
      }),

      hive_plan_write: tool({
        description: 'Write plan.md (clears existing comments)',
        args: {
          content: tool.schema.string().describe('Plan markdown content'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ content, feature: explicitFeature }, toolContext) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";

          // GATE: Check for discovery section with substantive content
          const discoveryMatch = content.match(/^##\s+Discovery\s*$/im);
          if (!discoveryMatch) {
            return `BLOCKED: Discovery section required before planning.

Your plan must include a \`## Discovery\` section documenting:
- Questions you asked and answers received
- Research findings from codebase exploration
- Key decisions made

Add this section to your plan content and try again.`;
          }
          
          // Extract content between ## Discovery and next ## heading (or end)
          const afterDiscovery = content.slice(discoveryMatch.index! + discoveryMatch[0].length);
          const nextHeading = afterDiscovery.search(/^##\s+/m);
          const discoveryContent = nextHeading > -1
            ? afterDiscovery.slice(0, nextHeading).trim()
            : afterDiscovery.trim();
          
          if (discoveryContent.length < 100) {
            return `BLOCKED: Discovery section is too thin (${discoveryContent.length} chars, minimum 100).

A substantive Discovery section should include:
- Original request quoted
- Interview summary (key decisions)
- Research findings with file:line references

Expand your Discovery section and try again.`;
          }

          captureSession(feature, toolContext);
          const planPath = planService.write(feature, content);
          return `Plan written to ${planPath}. Comments cleared for fresh review.`;
        },
      }),

      hive_plan_read: tool({
        description: 'Read plan.md and user comments',
        args: {
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ feature: explicitFeature }, toolContext) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";
          captureSession(feature, toolContext);
          const result = planService.read(feature);
          if (!result) return "Error: No plan.md found";
          return JSON.stringify(result, null, 2);
        },
      }),

      hive_plan_approve: tool({
        description: 'Approve plan for execution',
        args: {
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ feature: explicitFeature }, toolContext) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";
          captureSession(feature, toolContext);
          const comments = planService.getComments(feature);
          if (comments.length > 0) {
            return `Error: Cannot approve - ${comments.length} unresolved comment(s). Address them first.`;
          }
          planService.approve(feature);
          return "Plan approved. Run hive_tasks_sync to generate tasks.";
        },
      }),

      hive_tasks_sync: tool({
        description: 'Generate tasks from approved plan',
        args: {
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ feature: explicitFeature }) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";
          const featureData = featureService.get(feature);
          if (!featureData || featureData.status === 'planning') {
            return "Error: Plan must be approved first";
          }
          const result = taskService.sync(feature);
          if (featureData.status === 'approved') {
            featureService.updateStatus(feature, 'executing');
          }
          return `Tasks synced: ${result.created.length} created, ${result.removed.length} removed, ${result.kept.length} kept`;
        },
      }),

      hive_task_create: tool({
        description: 'Create manual task (not from plan)',
        args: {
          name: tool.schema.string().describe('Task name'),
          order: tool.schema.number().optional().describe('Task order'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ name, order, feature: explicitFeature }) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";
          const folder = taskService.create(feature, name, order);
          return `Manual task created: ${folder}\nReminder: start work with hive_worktree_start to use its worktree, and ensure any subagents work in that worktree too.`;
        },
      }),

      hive_task_update: tool({
        description: 'Update task status or summary',
        args: {
          task: tool.schema.string().describe('Task folder name'),
          status: tool.schema.string().optional().describe('New status: pending, in_progress, done, cancelled'),
          summary: tool.schema.string().optional().describe('Summary of work'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ task, status, summary, feature: explicitFeature }) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";
          const updated = taskService.update(feature, task, {
            status: status as any,
            summary,
          });
          return `Task "${task}" updated: status=${updated.status}`;
        },
      }),

      hive_worktree_start: tool({
        description: 'Create worktree and begin work on pending/in-progress task. Spawns Forager worker automatically.',
        args: {
          task: tool.schema.string().describe('Task folder name'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ task, feature: explicitFeature }) {
          return executeWorktreeStart({ task, feature: explicitFeature });
        },
      }),

      hive_worktree_batch: tool({
        description: 'Start multiple independent tasks in parallel. Use when tasks have no dependencies on each other. Check hive_status first to find runnable tasks.',
        args: {
          tasks: tool.schema.array(tool.schema.string()).describe('Array of task folder names to start in parallel'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ tasks, feature: explicitFeature }) {
          const resolvedFeature = resolveFeature(explicitFeature);
          if (!resolvedFeature) {
            return respond({
              success: false,
              terminal: true,
              error: 'No feature specified. Create a feature or provide feature param.',
              reason: 'feature_required',
              hints: [
                'Create/select a feature first or pass the feature parameter explicitly.',
                'Use hive_status to inspect the active feature state before retrying.',
              ],
            });
          }
          
          const results: Array<{
            task: string;
            success: boolean;
            response?: string;
            error?: string;
          }> = [];
          const openDelegations: Array<{
            task: string;
            taskToolCall: {
              subagent_type: string;
              description: string;
              prompt: string;
            };
            instructions?: string;
          }> = [];
          
          // Start each task
          for (const task of tasks) {
            try {
              const result = await executeWorktreeStart({ task, feature: resolvedFeature });
              const parsed = JSON.parse(result);
              const entry: {
                task: string;
                success: boolean;
                response?: string;
                error?: string;
              } = {
                task,
                success: parsed.success,
              };
              if (parsed.success) {
                // Collect delegation info if the worktree launch needs it
                if (parsed.delegationRequired && parsed.taskToolCall) {
                  openDelegations.push({
                    task,
                    taskToolCall: parsed.taskToolCall,
                    instructions: parsed.instructions,
                  });
                }
              } else {
                entry.error = parsed.error || 'Unknown error';
              }
              results.push(entry);
            } catch (e) {
              results.push({
                task,
                success: false,
                error: String(e),
              });
            }
          }
          
          // Summary
          const succeeded = results.filter(r => r.success).length;
          const failed = results.filter(r => !r.success).length;
          const hasDelegations = openDelegations.length > 0;
          
          const base: Record<string, unknown> = {
            success: failed === 0,
            terminal: !hasDelegations,
            batch: true,
            feature: resolvedFeature,
            total: tasks.length,
            succeeded,
            failed,
            results,
            summary: `Batch dispatch: ${succeeded}/${tasks.length} tasks started${failed > 0 ? `, ${failed} failed` : ''}${hasDelegations ? `. ${openDelegations.length} task(s) need worker delegation.` : ''}`,
          };
          
          if (hasDelegations) {
            base.openDelegations = openDelegations;
            base.mode = 'delegate-batch';
            base.delegationRequired = true;
            base.delegationHint = `Call task() for each open delegation to spawn workers. Use the taskToolCall from each entry.`;
          }
          
          return respond(base);
        },
      }),

      hive_worktree_create: tool({
        description: 'Resume a blocked task in its existing worktree. Spawns Forager worker automatically.',
        args: {
          task: tool.schema.string().describe('Task folder name'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
          continueFrom: tool.schema.enum(['blocked']).optional().describe('Resume a blocked task'),
          decision: tool.schema.string().optional().describe('Answer to blocker question when continuing'),
        },
        async execute({ task, feature: explicitFeature, continueFrom, decision }) {
          return executeBlockedResume({ task, feature: explicitFeature, continueFrom, decision });
        },
      }),

      hive_worktree_commit: tool({
        description: 'Complete task: commit changes to branch, write report. Supports blocked/failed/partial status for worker communication. Returns JSON with ok/terminal semantics for worker control flow.',
        args: {
          task: tool.schema.string().describe('Task folder name'),
          summary: tool.schema.string().describe('Summary of what was done'),
          status: tool.schema.enum(['completed', 'blocked', 'failed', 'partial']).optional().default('completed').describe('Task completion status'),
          blocker: tool.schema.object({
            reason: tool.schema.string().describe('Why the task is blocked'),
            options: tool.schema.array(tool.schema.string()).optional().describe('Available options for the user'),
            recommendation: tool.schema.string().optional().describe('Your recommended choice'),
            context: tool.schema.string().optional().describe('Additional context for the decision'),
          }).optional().describe('Blocker info when status is blocked'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ task, summary, status = 'completed', blocker, feature: explicitFeature }) {
          const respond = (payload: Record<string, unknown>) => JSON.stringify(payload, null, 2);
          const feature = resolveFeature(explicitFeature);
          if (!feature) {
            return respond({
              ok: false,
              terminal: false,
              status: 'error',
              reason: 'feature_required',
              task,
              taskState: 'unknown',
              message: 'No feature specified. Create a feature or provide feature param.',
              nextAction: 'Provide feature explicitly or create/select an active feature, then retry hive_worktree_commit.',
            });
          }

          const taskInfo = taskService.get(feature, task);
          if (!taskInfo) {
            return respond({
              ok: false,
              terminal: false,
              status: 'error',
              reason: 'task_not_found',
              feature,
              task,
              taskState: 'unknown',
              message: `Task "${task}" not found`,
              nextAction: 'Check the task folder name in your worker-prompt.md and retry hive_worktree_commit with the correct task id.',
            });
          }
          if (taskInfo.status !== 'in_progress' && taskInfo.status !== 'blocked') {
            return respond({
              ok: false,
              terminal: false,
              status: 'error',
              reason: 'invalid_task_state',
              feature,
              task,
              taskState: taskInfo.status,
              message: 'Task not in progress',
              nextAction: 'Only in_progress or blocked tasks can be committed. Start/resume the task first.',
            });
          }

          // ADVISORY: Track verification status (workers do best-effort)
          let verificationNote: string | undefined;
          if (status === 'completed') {
            const verificationKeywords = ['test', 'build', 'lint', 'vitest', 'jest', 'npm run', 'pnpm', 'cargo', 'pytest', 'verified', 'passes', 'succeeds', 'ast-grep', 'scan'];
            const summaryLower = summary.toLowerCase();
            const hasVerificationMention = verificationKeywords.some(kw => summaryLower.includes(kw));

            if (!hasVerificationMention) {
              verificationNote = 'No verification evidence in summary. Orchestrator should run build+test after merge.';
            }
          }

          // Handle blocked status - don't commit, just update status
          if (status === 'blocked') {
            taskService.update(feature, task, {
              status: 'blocked',
              summary,
              blocker: blocker as any,
            } as any);

            const worktree = await worktreeService.get(feature, task);
            return respond({
              ok: true,
              terminal: true,
              status: 'blocked',
              reason: 'user_decision_required',
              feature,
              task,
              taskState: 'blocked',
              summary,
              blocker,
              worktreePath: worktree?.path,
              branch: worktree?.branch,
              message: 'Task blocked. Hive Master will ask user and resume with hive_worktree_create(continueFrom: "blocked", decision: answer)',
              nextAction: 'Wait for orchestrator to collect user decision and resume with continueFrom: "blocked".',
            });
          }

          // For failed/partial, still commit what we have
          const commitResult = await worktreeService.commitChanges(feature, task, `hive(${task}): ${summary.slice(0, 50)}`);

          if (status === 'completed' && !commitResult.committed && commitResult.message !== 'No changes to commit') {
            return respond({
              ok: false,
              terminal: false,
              status: 'rejected',
              reason: 'commit_failed',
              feature,
              task,
              taskState: taskInfo.status,
              summary,
              commit: {
                committed: commitResult.committed,
                sha: commitResult.sha,
                message: commitResult.message,
              },
              message: `Commit failed: ${commitResult.message || 'unknown error'}`,
              nextAction: 'Resolve git/worktree issue, then call hive_worktree_commit again.',
            });
          }

          const diff = await worktreeService.getDiff(feature, task);

          const statusLabel = status === 'completed' ? 'success' : status;
          const reportLines: string[] = [
            `# Task Report: ${task}`,
            '',
            `**Feature:** ${feature}`,
            `**Completed:** ${new Date().toISOString()}`,
            `**Status:** ${statusLabel}`,
            `**Commit:** ${commitResult.sha || 'none'}`,
            '',
            '---',
            '',
            '## Summary',
            '',
            summary,
            '',
          ];

          if (diff?.hasDiff) {
            reportLines.push(
              '---',
              '',
              '## Changes',
              '',
              `- **Files changed:** ${diff.filesChanged.length}`,
              `- **Insertions:** +${diff.insertions}`,
              `- **Deletions:** -${diff.deletions}`,
              '',
            );

            if (diff.filesChanged.length > 0) {
              reportLines.push('### Files Modified', '');
              for (const file of diff.filesChanged) {
                reportLines.push(`- \`${file}\``);
              }
              reportLines.push('');
            }
          } else {
            reportLines.push('---', '', '## Changes', '', '_No file changes detected_', '');
          }

          const reportPath = taskService.writeReport(feature, task, reportLines.join('\n'));

          const finalStatus = status === 'completed' ? 'done' : status;
          taskService.update(feature, task, { status: finalStatus as any, summary });

          const worktree = await worktreeService.get(feature, task);
          return respond({
            ok: true,
            terminal: true,
            status,
            feature,
            task,
            taskState: finalStatus,
            summary,
            ...(verificationNote && { verificationNote }),
            commit: {
              committed: commitResult.committed,
              sha: commitResult.sha,
              message: commitResult.message,
            },
            worktreePath: worktree?.path,
            branch: worktree?.branch,
            reportPath,
            message: `Task "${task}" ${status}.`,
            nextAction: 'Use hive_merge to integrate changes. Worktree is preserved for review.',
          });
        },
      }),

      hive_worktree_discard: tool({
        description: 'Abort task: discard changes, reset status',
        args: {
          task: tool.schema.string().describe('Task folder name'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        },
        async execute({ task, feature: explicitFeature }) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";

          await worktreeService.remove(feature, task);
          taskService.update(feature, task, { status: 'pending' });

          return `Task "${task}" aborted. Status reset to pending.`;
        },
      }),


      hive_merge: tool({
        description: 'Merge completed task branch into current branch (explicit integration)',
        args: {
          task: tool.schema.string().describe('Task folder name to merge'),
          strategy: tool.schema.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy (default: merge)'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
        },
        async execute({ task, strategy = 'merge', feature: explicitFeature }) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";

          const taskInfo = taskService.get(feature, task);
          if (!taskInfo) return `Error: Task "${task}" not found`;
          if (taskInfo.status !== 'done') return "Error: Task must be completed before merging. Use hive_worktree_commit first.";

          const result = await worktreeService.merge(feature, task, strategy);

          if (!result.success) {
            if (result.conflicts && result.conflicts.length > 0) {
              return `Merge failed with conflicts in:\n${result.conflicts.map(f => `- ${f}`).join('\n')}\n\nResolve conflicts manually or try a different strategy.`;
            }
            return `Merge failed: ${result.error}`;
          }

          return `Task "${task}" merged successfully using ${strategy} strategy.\nCommit: ${result.sha}\nFiles changed: ${result.filesChanged?.length || 0}`;
        },
      }),

      // Context Tools
      hive_context_write: tool({
        description: 'Write a context file for the feature. Context files store persistent notes, decisions, and reference material.',
        args: {
          name: tool.schema.string().describe('Context file name (e.g., "decisions", "architecture", "notes")'),
          content: tool.schema.string().describe('Markdown content to write'),
          feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
        },
        async execute({ name, content, feature: explicitFeature }) {
          const feature = resolveFeature(explicitFeature);
          if (!feature) return "Error: No feature specified. Create a feature or provide feature param.";

          const filePath = contextService.write(feature, name, content);
          return `Context file written: ${filePath}`;
        },
      }),

      // Status Tool
      hive_status: tool({
        description: 'Get comprehensive status of a feature including plan, tasks, and context. Returns JSON with all relevant state for resuming work.',
        args: {
          feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
        },
        async execute({ feature: explicitFeature }) {
          const respond = (payload: Record<string, unknown>) => JSON.stringify(payload, null, 2);
          const feature = resolveFeature(explicitFeature);
          if (!feature) {
            return respond({
              success: false,
              terminal: true,
              reason: 'feature_required',
              error: 'No feature specified and no active feature found',
              hint: 'Use hive_feature_create to create a new feature',
            });
          }

          const featureData = featureService.get(feature);
          if (!featureData) {
            return respond({
              success: false,
              terminal: true,
              reason: 'feature_not_found',
              error: `Feature '${feature}' not found`,
              availableFeatures: featureService.list(),
            });
          }

          const blocked = checkBlocked(feature);
          if (blocked) {
            return respond({
              success: false,
              terminal: true,
              blocked: true,
              error: blocked,
              hints: [
                'Read the blocker details and resolve them before retrying hive_status.',
                `Remove .hive/features/${feature}/BLOCKED once the blocker is resolved.`,
              ],
            });
          }

          const plan = planService.read(feature);
          const tasks = taskService.list(feature);
          const contextFiles = contextService.list(feature);

          const tasksSummary = await Promise.all(tasks.map(async t => {
            const rawStatus = taskService.getRawStatus(feature, t.folder);
            const worktree = await worktreeService.get(feature, t.folder);
            const hasChanges = worktree
              ? await worktreeService.hasUncommittedChanges(worktree.feature, worktree.step)
              : null;

            return {
              folder: t.folder,
              name: t.name,
              status: t.status,
              origin: t.origin || 'plan',
              dependsOn: rawStatus?.dependsOn ?? null,
              worktree: worktree ? {
                branch: worktree.branch,
                hasChanges,
              } : null,
            };
          }));

          const contextSummary = contextFiles.map(c => ({
            name: c.name,
            chars: c.content.length,
            updatedAt: c.updatedAt,
          }));

          const pendingTasks = tasksSummary.filter(t => t.status === 'pending');
          const inProgressTasks = tasksSummary.filter(t => t.status === 'in_progress');
          const doneTasks = tasksSummary.filter(t => t.status === 'done');

          const tasksWithDeps = tasksSummary.map(t => ({
            folder: t.folder,
            status: t.status,
            dependsOn: t.dependsOn ?? undefined,
          }));
          const effectiveDeps = buildEffectiveDependencies(tasksWithDeps);
          const normalizedTasks = tasksWithDeps.map(task => ({
            ...task,
            dependsOn: effectiveDeps.get(task.folder),
          }));
          const { runnable, blocked: blockedBy } = computeRunnableAndBlocked(normalizedTasks);

          const getNextAction = (planStatus: string | null, tasks: Array<{ status: string; folder: string }>, runnableTasks: string[]): string => {
            if (!planStatus || planStatus === 'draft') {
              return 'Write or revise plan with hive_plan_write, then get approval';
            }
            if (planStatus === 'review') {
              return 'Wait for plan approval or revise based on comments';
            }
            if (tasks.length === 0) {
              return 'Generate tasks from plan with hive_tasks_sync';
            }
            const inProgress = tasks.find(t => t.status === 'in_progress');
            if (inProgress) {
              return `Continue work on task: ${inProgress.folder}`;
            }
            if (runnableTasks.length > 1) {
              return `${runnableTasks.length} tasks are ready to start in parallel: ${runnableTasks.join(', ')}`;
            }
            if (runnableTasks.length === 1) {
              return `Start next task with hive_worktree_start: ${runnableTasks[0]}`;
            }
            const pending = tasks.find(t => t.status === 'pending');
            if (pending) {
              return `Pending tasks exist but are blocked by dependencies. Check blockedBy for details.`;
            }
            return 'All tasks complete. Review and merge or complete feature.';
          };

          const planStatus = featureData.status === 'planning' ? 'draft' :
            featureData.status === 'approved' ? 'approved' :
              featureData.status === 'executing' ? 'locked' : 'none';

          return respond({
            feature: {
              name: feature,
              status: featureData.status,
              ticket: featureData.ticket || null,
              createdAt: featureData.createdAt,
            },
            plan: {
              exists: !!plan,
              status: planStatus,
              approved: planStatus === 'approved' || planStatus === 'locked',
            },
            tasks: {
              total: tasks.length,
              pending: pendingTasks.length,
              inProgress: inProgressTasks.length,
              done: doneTasks.length,
              list: tasksSummary,
              runnable,
              blockedBy,
            },
            context: {
              fileCount: contextFiles.length,
              files: contextSummary,
            },
            nextAction: getNextAction(planStatus, tasksSummary, runnable),
          });
        },
      }),

      // AGENTS.md Tool
      hive_agents_md: tool({
        description: 'Initialize or sync AGENTS.md. init: scan codebase and generate (preview only). sync: propose updates from feature contexts. apply: write approved content to disk.',
        args: {
          action: tool.schema.enum(['init', 'sync', 'apply']).describe('Action to perform'),
          feature: tool.schema.string().optional().describe('Feature name for sync action'),
          content: tool.schema.string().optional().describe('Content to write (required for apply action)'),
        },
        async execute({ action, feature, content }) {
          if (action === 'init') {
            const result = await agentsMdService.init();
            if (result.existed) {
              return `AGENTS.md already exists (${result.content.length} chars). Use 'sync' to propose updates.`;
            }
            // P2 gate: Return content for review — ask user via question() before writing
            return `Generated AGENTS.md from codebase scan (${result.content.length} chars):\n\n${result.content}\n\n⚠️ This has NOT been written to disk. Ask the user via question() whether to write it to AGENTS.md.`;
          }

          if (action === 'sync') {
            if (!feature) return 'Error: feature name required for sync action';
            const result = await agentsMdService.sync(feature);
            if (result.proposals.length === 0) {
              return 'No new findings to sync to AGENTS.md.';
            }
            // P2 gate: Return diff for review — never auto-apply
            return `Proposed AGENTS.md updates from feature "${feature}":\n\n${result.diff}\n\n⚠️ These changes have NOT been applied. Ask the user via question() whether to apply them.`;
          }

          if (action === 'apply') {
            if (!content) return 'Error: content required for apply action. Use init or sync first to get content, then apply with the approved content.';
            const result = agentsMdService.apply(content);
            return `AGENTS.md ${result.isNew ? 'created' : 'updated'} (${result.chars} chars) at ${result.path}`;
          }

          return 'Error: unknown action';
        },
      }),

    },

    command: {
      hive: {
        description: "Create a new feature: /hive <feature-name>",
        async run(args: string) {
          const name = args.trim();
          if (!name) return "Usage: /hive <feature-name>";
          return `Create feature "${name}" using hive_feature_create tool.`;
        },
      },
    },

    // Config hook - merge agents into opencodeConfig.agent
    config: async (opencodeConfig: Record<string, unknown>) => {
      function agentTools(allowed: string[]): Record<string, boolean> {
        const allHiveTools = [
          'hive_feature_create', 'hive_feature_complete',
          'hive_plan_write', 'hive_plan_read', 'hive_plan_approve',
          'hive_tasks_sync', 'hive_task_create', 'hive_task_update',
          'hive_worktree_start', 'hive_worktree_create', 'hive_worktree_commit', 'hive_worktree_discard',
          'hive_merge', 'hive_context_write', 'hive_status', 'hive_skill', 'hive_agents_md',
        ];
        const result: Record<string, boolean> = {};
        for (const tool of allHiveTools) {
          if (!allowed.includes(tool)) {
            result[tool] = false;
          }
        }
        return result;
      }
      // Auto-generate config file with defaults if it doesn't exist
      configService.init();
      const hiveConfigData = configService.get();
      const agentMode = hiveConfigData.agentMode ?? 'unified';

      const customAgentConfigs = configService.getCustomAgentConfigs();
      const customSubagentAppendix = Object.keys(customAgentConfigs).length === 0
        ? ''
        : `\n\n## Configured Custom Subagents\n${Object.entries(customAgentConfigs)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, config]) => `- \`${name}\` — derived from \`${config.baseAgent}\`; ${config.description}`)
          .join('\n')}`;

      // Build auto-loaded skill content for each agent
      const zettaUserConfig = configService.getAgentConfig('zetta');
      const zettaAutoLoadedSkills = await buildAutoLoadedSkillsContent('zetta', configService, directory);
      const zettaConfig = {
        model: zettaUserConfig.model,
        variant: zettaUserConfig.variant,
        temperature: zettaUserConfig.temperature ?? 0.5,
        description: 'Zetta (Hybrid) - Plans + orchestrates. Detects phase, loads skills on-demand.',
        prompt: QUEEN_BEE_PROMPT + zettaAutoLoadedSkills + (agentMode !== 'separate' ? customSubagentAppendix : ''),
        permission: {
          read: "allow",
          write: "allow",
          edit: "allow",
          task: "allow",
          delegate: "allow",
          question: "allow",
          skill: "allow",
          todowrite: "allow",
          todoread: "allow",
          webfetch: "allow",
          ask: "allow",
          bash: "allow",
          external_directory: "allow",
        },
            };

      const scoutUserConfig = configService.getAgentConfig('scout-researcher');
      const scoutAutoLoadedSkills = await buildAutoLoadedSkillsContent('scout-researcher', configService, directory);
      const scoutConfig = {
        model: scoutUserConfig.model,
        variant: scoutUserConfig.variant,
        temperature: scoutUserConfig.temperature ?? 0.5,
        mode: 'subagent' as const,
        description: 'Scout (Explorer/Researcher/Retrieval) - Researches codebase + external docs/data.',
        prompt: SCOUT_BEE_PROMPT + scoutAutoLoadedSkills + (scoutUserConfig.customPrompt ? '\n\n' + scoutUserConfig.customPrompt : ''),
        tools: agentTools(['hive_plan_read', 'hive_context_write', 'hive_status', 'hive_skill']),
        permission: {
          read: "allow",
          write: "allow",
          edit: "deny",  // Researchers don't edit code
          task: "deny",
          delegate: "deny",
          skill: "allow",
          webfetch: "allow",
          external_directory: "allow",
        },
      };

      const foragerUserConfig = configService.getAgentConfig('forager-worker');
      const foragerAutoLoadedSkills = await buildAutoLoadedSkillsContent('forager-worker', configService, directory);
      const foragerConfig = {
        model: foragerUserConfig.model,
        variant: foragerUserConfig.variant,
        temperature: foragerUserConfig.temperature ?? 0.3,
        mode: 'subagent' as const,
        description: 'Forager (Worker/Coder) - Executes tasks directly in isolated worktrees. Never delegates.',
        prompt: FORAGER_BEE_PROMPT + foragerAutoLoadedSkills + (foragerUserConfig.customPrompt ? '\n\n' + foragerUserConfig.customPrompt : ''),
        tools: agentTools(['hive_plan_read', 'hive_worktree_commit', 'hive_context_write', 'hive_skill']),
        permission: {
          read: "allow",
          write: "allow",
          edit: "allow",
          task: "deny",
          delegate: "deny",
          skill: "allow",
          external_directory: "allow",
        },
      };

      const hygienicUserConfig = configService.getAgentConfig('hygienic-reviewer');
      const hygienicAutoLoadedSkills = await buildAutoLoadedSkillsContent('hygienic-reviewer', configService, directory);
      const hygienicConfig = {
        model: hygienicUserConfig.model,
        variant: hygienicUserConfig.variant,
        temperature: hygienicUserConfig.temperature ?? 0.3,
        mode: 'subagent' as const,
        description: 'Hygienic (Consultant/Reviewer/Debugger) - Reviews plan documentation quality. OKAY/REJECT verdict.',
        prompt: HYGIENIC_BEE_PROMPT + hygienicAutoLoadedSkills + (hygienicUserConfig.customPrompt ? '\n\n' + hygienicUserConfig.customPrompt : ''),
        tools: agentTools(['hive_plan_read', 'hive_context_write', 'hive_status', 'hive_skill']),
        permission: {
          read: "allow",
          edit: "deny",  // Reviewers don't edit
          task: "deny",
          delegate: "deny",
          skill: "allow",
        },
      };

      // Micode agents (from micode plugin)
      const micodeUserConfig = configService.getAgentConfig('codebase-locator');
      const codebaseLocatorConfig = {
        model: micodeUserConfig.model,
        variant: micodeUserConfig.variant,
        temperature: micodeUserConfig.temperature ?? 0.3,
        mode: 'subagent' as const,
        description: 'Codebase Locator - Finds WHERE files live in the codebase. No analysis, just locations.',
        prompt: CODEBASE_LOCATOR_PROMPT,
        tools: agentTools(['hive_plan_read', 'hive_skill']),
        permission: {
          read: "allow",
          edit: "deny",
          task: "deny",
          delegate: "deny",
          skill: "allow",
        },
      };

      const codebaseAnalyzerConfig = {
        model: micodeUserConfig.model,
        variant: micodeUserConfig.variant,
        temperature: micodeUserConfig.temperature ?? 0.3,
        mode: 'subagent' as const,
        description: 'Codebase Analyzer - Explains HOW code works. Deep module analysis.',
        prompt: CODEBASE_ANALYZER_PROMPT,
        tools: agentTools(['hive_plan_read', 'hive_skill']),
        permission: {
          read: "allow",
          edit: "deny",
          task: "deny",
          delegate: "deny",
          skill: "allow",
        },
      };

      // Built-in agent configs
      const builtInAgentConfigs = {
        'zetta': zettaConfig,
        'scout-researcher': scoutConfig,
        'forager-worker': foragerConfig,
        'hygienic-reviewer': hygienicConfig,
        'codebase-locator': codebaseLocatorConfig,
        'codebase-analyzer': codebaseAnalyzerConfig,
      };

      // Remove undefined/empty model fields from all agent configs
      // so OpenCode uses its default model when no model is specified.
      for (const cfg of Object.values(builtInAgentConfigs)) {
        if (cfg && typeof cfg === 'object' && !('model' in cfg)) continue;
        if (cfg && typeof cfg === 'object' && !cfg.model) {
          delete (cfg as Record<string, unknown>).model;
        }
      }

      const customAutoLoadedSkills = Object.fromEntries(
        await Promise.all(
          Object.entries(customAgentConfigs).map(async ([customAgentName, customAgentConfig]) => {
            const inheritedBaseSkills = customAgentConfig.baseAgent === 'forager-worker'
              ? (foragerUserConfig.autoLoadSkills ?? [])
              : (hygienicUserConfig.autoLoadSkills ?? []);
            const deltaAutoLoadSkills = (customAgentConfig.autoLoadSkills ?? []).filter(
              (skill) => !inheritedBaseSkills.includes(skill),
            );

            return [
              customAgentName,
              await buildAutoLoadedSkillsContent(customAgentName, configService, directory, deltaAutoLoadSkills),
            ];
          }),
        ),
      );

      const customSubagents = buildCustomSubagents({
        customAgents: customAgentConfigs,
        baseAgents: {
          'forager-worker': foragerConfig,
          'hygienic-reviewer': hygienicConfig,
        },
        autoLoadedSkills: customAutoLoadedSkills,
      });

      // Build agents map based on agentMode
      const allAgents: Record<string, unknown> = {};
      
      if (agentMode === 'unified') {
        allAgents['zetta'] = builtInAgentConfigs['zetta'];
        allAgents['scout-researcher'] = builtInAgentConfigs['scout-researcher'];
        allAgents['forager-worker'] = builtInAgentConfigs['forager-worker'];
        allAgents['hygienic-reviewer'] = builtInAgentConfigs['hygienic-reviewer'];
        allAgents['codebase-locator'] = builtInAgentConfigs['codebase-locator'];
        allAgents['codebase-analyzer'] = builtInAgentConfigs['codebase-analyzer'];
      } else {
        allAgents['zetta'] = builtInAgentConfigs['zetta'];
        allAgents['scout-researcher'] = builtInAgentConfigs['scout-researcher'];
        allAgents['forager-worker'] = builtInAgentConfigs['forager-worker'];
        allAgents['hygienic-reviewer'] = builtInAgentConfigs['hygienic-reviewer'];
        allAgents['codebase-locator'] = builtInAgentConfigs['codebase-locator'];
        allAgents['codebase-analyzer'] = builtInAgentConfigs['codebase-analyzer'];
      }

      Object.assign(allAgents, customSubagents);

      // Final sanitization: remove undefined/empty model fields from ALL agents
      // so OpenCode uses its default model when none is explicitly configured.
      for (const cfg of Object.values(allAgents)) {
        if (cfg && typeof cfg === 'object' && 'model' in cfg && !(cfg as Record<string, unknown>).model) {
          delete (cfg as Record<string, unknown>).model;
        }
      }

      // Determine the primary agent
      const primaryAgent = 'zetta';

      // Ensure all our agents are properly configured with mode
      // Primary agent gets no mode (default), subagents get mode: 'subagent'
      for (const [agentName, agentConfig] of Object.entries(allAgents)) {
        if (agentName !== primaryAgent && agentConfig && typeof agentConfig === 'object') {
          (agentConfig as Record<string, unknown>).mode = 'subagent';
        }
      }

      // Inject MCP strategy into every agent prompt
      const mcpStrategy = `

## Available MCPs
| MCP | Tools | Use for |
|-----|-------|---------|
| websearch | websearch_web_search_exa | Current web info |
| context7 | context7_query-docs, context7_resolve-library-id | Library docs |
| grep_app | grep_app_searchGitHub | GitHub code patterns |
| repomix | pack_codebase, pack_remote_repository | Repo packing |
| crw (if CRW_API_URL set) | crw_scrape, crw_crawl, crw_map, crw_search | Web scraping & crawling |
| ast_grep | ast_grep_find_code, ast_grep_rewrite_code | AST code analysis |
Use these tools when the task matches their purpose. They are available as regular tools.`;
      for (const agentConfig of Object.values(allAgents)) {
        if (agentConfig && typeof agentConfig === 'object') {
          const prompt = (agentConfig as Record<string, unknown>).prompt;
          if (typeof prompt === 'string' && !prompt.includes('## Available MCPs')) {
            (agentConfig as Record<string, unknown>).prompt = prompt + mcpStrategy;
          }
        }
      }

      // Merge agents into opencodeConfig.agent
      const configAgent = (opencodeConfig.agent ??= {}) as Record<string, unknown>;
      
      // Clean up old single-word agent names
      delete configAgent.hive;
      delete configAgent.architect;
      delete configAgent.swarm;
      delete configAgent.scout;
      delete configAgent.forager;
      delete configAgent.hygienic;
      delete configAgent.receiver;
      // Clean up old kebab-case names (in case they exist)
      delete configAgent['hive'];
      delete configAgent['architect-planner'];
      delete configAgent['swarm-orchestrator'];
      delete configAgent['scout-researcher'];
      delete configAgent['forager-worker'];
      delete configAgent['hygienic-reviewer'];
      
      // Demote built-in OpenCode agents to subagent mode
      // This makes zetta the primary agent instead of the default build/plan
      // IMPORTANT: We MUST create entries for these agents if they don't exist
      // because OpenCode's built-in agents might not be in the config yet
      const opencodeBuiltInAgents = ['build', 'plan', 'triage', 'docs', 'ask', 'claude-code'];
      for (const agentName of opencodeBuiltInAgents) {
        if (!configAgent[agentName]) {
          configAgent[agentName] = {};
        }
        (configAgent[agentName] as Record<string, unknown>).mode = 'subagent';
      }
      
      // Demote all our agents except primary
      for (const [agentName, agentConfig] of Object.entries(allAgents)) {
        if (agentName !== primaryAgent && agentConfig && typeof agentConfig === 'object') {
          (agentConfig as Record<string, unknown>).mode = 'subagent';
        }
      }
      
      Object.assign(configAgent, allAgents);

      // CRITICAL: Set default agent - this is what makes zetta the primary agent
      // Without this, OpenCode uses its own default agent
      (opencodeConfig as Record<string, unknown>).default_agent = primaryAgent;

      // Merge built-in MCP servers (OMO-style remote endpoints)
      // Only add MCPs that user hasn't already configured in their opencode.json
      const configMcp = opencodeConfig.mcp as Record<string, unknown> | undefined;
      const mcpToAdd = builtinMcps;
      
      if (!configMcp) {
        // No MCP config at all - use all built-in MCPs
        opencodeConfig.mcp = mcpToAdd;
      } else {
        // User has MCP config - only add MCPs they haven't configured
        // This preserves user's MCP settings (like grep_app, ast_grep from opencode.json)
        for (const [name, config] of Object.entries(mcpToAdd)) {
          if (!(name in configMcp)) {
            configMcp[name] = config;
          }
        }
      }

    },
  };
};

export default plugin;
