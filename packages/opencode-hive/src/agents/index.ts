/**
 * Hive Agents
 * 
 * The Hive Colony Model:
 * - Hive (Hybrid): Plans AND orchestrates based on phase
 * - Architect (Planner): Plans features, interviews, writes plans
 * - Swarm (Orchestrator): Delegates, spawns workers, verifies, merges
 * - Scout (Research/Collector): Explores codebase and external docs
 * - Forager (Worker/Coder): Executes tasks in isolation
 * - Hygienic (Consultant/Reviewer): Reviews plan quality
 * 
 * Additional Agents (from opencode-froggy):
 * - Code Reviewer: Reviews code for quality, correctness, security
 * - Code Simplifier: Simplifies code for clarity while preserving behavior
 * 
 * Additional Agents (from micode):
 * - Codebase Locator: Finds WHERE files live in codebase
 * - Codebase Analyzer: Explains HOW code works with file:line refs
 * - Pattern Finder: Finds existing patterns to model after
 * - Project Initializer: Generates ARCHITECTURE.md and CODE_STYLE.md
 */

// Bee agents (lean, focused)
export { hiveBeeAgent, QUEEN_BEE_PROMPT } from './hive';
export { architectBeeAgent, ARCHITECT_BEE_PROMPT } from './architect';
export { swarmBeeAgent, SWARM_BEE_PROMPT } from './swarm';
export { scoutBeeAgent, SCOUT_BEE_PROMPT } from './scout';
export { foragerBeeAgent, FORAGER_BEE_PROMPT } from './forager';
export { hygienicBeeAgent, HYGIENIC_BEE_PROMPT } from './hygienic';

// Froggy agents
export { codeReviewerAgent, CODE_REVIEWER_PROMPT } from './code-reviewer';
export { codeSimplifierAgent, CODE_SIMPLIFIER_PROMPT } from './code-simplifier';

// Micode agents
export { codebaseLocatorAgent, CODEBASE_LOCATOR_PROMPT } from './codebase-locator';
export { codebaseAnalyzerAgent, CODEBASE_ANALYZER_PROMPT } from './codebase-analyzer';
export { patternFinderAgent, PATTERN_FINDER_PROMPT } from './pattern-finder';
export { projectInitializerAgent, PROJECT_INITIALIZER_PROMPT } from './project-initializer';


/**
 * Agent registry for OpenCode plugin
 * 
 * Bee Agents (recommended):
 * - hive: Hybrid planner + orchestrator (detects phase, loads skills)
 * - architect: Discovery/planning (requirements, plan writing)
 * - swarm: Orchestration (delegates, verifies, merges)
 * - scout: Research/collection (codebase + external docs/data)
 * - forager: Worker/coder (executes tasks in worktrees)
 * - hygienic: Consultant/reviewer (plan quality)
 * 
 * Froggy Agents:
 * - code-reviewer: Reviews code for quality, correctness, security
 * - code-simplifier: Simplifies code for clarity while preserving behavior
 * 
 * Micode Agents:
 * - codebase-locator: Finds WHERE files live
 * - codebase-analyzer: Explains HOW code works
 * - pattern-finder: Finds patterns to model after
 * - project-initializer: Generates project docs
 */
export const hiveAgents = {
  // Bee Agents (lean, focused - recommended)
  hive: {
    name: 'Hive (Hybrid)',
    description: 'Hybrid planner + orchestrator. Detects phase, loads skills on-demand.',
    mode: 'primary' as const,
  },
  architect: {
    name: 'Architect (Planner)',
    description: 'Plans features, interviews, writes plans. NEVER executes.',
    mode: 'primary' as const,
  },
  swarm: {
    name: 'Swarm (Orchestrator)',
    description: 'Orchestrates execution. Delegates, spawns workers, verifies, merges.',
    mode: 'primary' as const,
  },
  scout: {
    name: 'Scout (Explorer/Researcher/Retrieval)',
    description: 'Explores codebase, external docs, and retrieves external data.',
    mode: 'subagent' as const,
  },
  forager: {
    name: 'Forager (Worker/Coder)',
    description: 'Executes tasks directly in isolated worktrees. Never delegates.',
    mode: 'subagent' as const,
  },
  hygienic: {
    name: 'Hygienic (Consultant/Reviewer/Debugger)',
    description: 'Reviews plan documentation quality. OKAY/REJECT verdict.',
    mode: 'subagent' as const,
  },
  // Froggy agents
  'code-reviewer': {
    name: 'Code Reviewer',
    description: 'Reviews code for quality, correctness, and security.',
    mode: 'subagent' as const,
  },
  'code-simplifier': {
    name: 'Code Simplifier',
    description: 'Simplifies recently modified code for clarity and maintainability while strictly preserving behavior.',
    mode: 'subagent' as const,
  },
  // Micode agents
  'codebase-locator': {
    name: 'Codebase Locator',
    description: 'Finds WHERE files live in the codebase.',
    mode: 'subagent' as const,
  },
  'codebase-analyzer': {
    name: 'Codebase Analyzer',
    description: 'Explains HOW code works with precise file:line references.',
    mode: 'subagent' as const,
  },
  'pattern-finder': {
    name: 'Pattern Finder',
    description: 'Finds existing patterns and examples to model after.',
    mode: 'subagent' as const,
  },
  'project-initializer': {
    name: 'Project Initializer',
    description: 'Rapidly analyze any project and generate ARCHITECTURE.md and CODE_STYLE.md',
    mode: 'subagent' as const,
  },
};
