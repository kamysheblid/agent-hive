# Agent Guidelines for agent-hive

## Overview

**agent-hive** is a context-driven development system for AI coding assistants. It implements a plan-first workflow: Plan → Approve → Execute.

## Build & Test Commands

```bash
# Build all packages
bun run build

# Development mode (all packages)
bun run dev

# Run tests (from package directories)
bun run test              # Run all tests
bun run test -- <file>    # Run specific test

# Release preparation
bun run release:check     # Install, build, and test all packages
bun run release:prepare   # Prepare release
```

Worktree dependency note: worktrees are lightweight checkouts without project dependencies. Workers do best-effort verification using ast-grep (no dependencies needed). Full build and test verification (`bun run build` + `bun run test`) runs on the main branch after the orchestrator merges a batch of task branches.

### Package-Specific Commands

```bash
# From packages/hive-core/
bun run build             # Build hive-core
bun run test              # Run hive-core tests

# From packages/opencode-hive/
bun run build             # Build opencode-hive plugin
bun run dev               # Watch mode
```

## Code Style

### General

- **TypeScript ES2022** with ESM modules
- **Semicolons**: Yes, use semicolons
- **Quotes**: Single quotes for strings
- **Imports**: Use `.js` extension for local imports (ESM requirement)
- **Type imports**: Separate with `import type { X }` syntax
- **Naming**:
  - `camelCase` for variables, functions
  - `PascalCase` for types, interfaces, classes
  - Descriptive function names (`readFeatureJson`, `ensureFeatureDir`)

### TypeScript Patterns

```typescript
// Explicit type annotations
interface FeatureInfo {
  name: string;
  path: string;
  status: 'active' | 'completed';
}

// Classes for services
export class FeatureService {
  constructor(private readonly rootDir: string) {}
  
  async createFeature(name: string): Promise<FeatureInfo> {
    // ...
  }
}

// Async/await over raw promises
async function loadConfig(): Promise<Config> {
  const data = await fs.readFile(path, 'utf-8');
  return JSON.parse(data);
}
```

### File Organization

```
packages/
├── hive-core/           # Shared logic (services, types, utils)
│   └── src/
│       ├── services/    # FeatureService, TaskService, PlanService, etc.
│       ├── utils/       # paths.ts, detection.ts
│       └── types.ts     # Shared type definitions
├── opencode-hive/       # OpenCode plugin
│   └── src/
│       ├── agents/      # scout, swarm, hive, architect, forager, hygienic
│   ├── mcp/         # websearch, openserp, grep-app, context7, repomix, ast-grep
│       ├── tools/       # Hive tool implementations
│       ├── hooks/       # Event hooks
│       └── skills/      # Skill definitions
```

### Tests

- Test files use `.test.ts` suffix
- Place tests next to source files or in `__tests__/` directories
- Use descriptive test names

## Commit Messages

Use **Conventional Commits**:

```
feat: add parallel task execution
fix: handle missing worktree gracefully
docs: update skill documentation
chore: upgrade dependencies
refactor: extract worktree logic to service
test: add feature service unit tests
perf: cache resolved paths
```

Breaking changes use `!`:
```
feat!: change plan format to support subtasks
```

## Architecture Principles

### Core Philosophy

1. **Context Persists** - Write to `.hive/` files; memory is ephemeral
2. **Plan → Approve → Execute** - No code without approved plan
3. **Human Shapes, Agent Builds** - Humans decide direction, agents implement
4. **Good Enough Wins** - Ship working code, iterate later
5. **Batched Parallelism** - Delegate independent tasks to workers
6. **Tests Define Done** - Workers do best-effort checks; orchestrator runs full test suite after batch merge
7. **Iron Laws + Hard Gates** - Non-negotiable constraints per agent
8. **Cross-Model Prompts** — Agent prompts must work across all supported LLM providers. Use conditional triggers ("when X, do Y") instead of absolute mandates ("always do Y") or blanket defaults ("by default, do Y").

### Agent Roles

| Agent | Role |
|-------|------|
| Hive (Zetta) | Plans AND orchestrates; phase-aware |
| Architect | Plans features, interviews, writes plans. NEVER executes |
| Swarm | Orchestrates execution. Delegates, spawns workers, verifies |
| Scout | Researches codebase + external docs/data |
| Forager | Executes tasks directly in isolated worktrees |
| Hygienic | Reviews plan/code quality. OKAY/REJECT verdict |
| **Codebase Locator** | Finds WHERE files live — no analysis, just locations |
| **Codebase Analyzer** | Explains HOW code works — deep module analysis |
| **Pattern Finder** | Extracts conventions and recurring patterns |
| **Project Initializer** | Generates ARCHITECTURE.md + CODE_STYLE.md from analysis |

### Data Model

Features stored in `.hive/features/<name>/`:
```
.hive/features/my-feature/
├── feature.json       # Feature metadata
├── plan.md            # Implementation plan
├── tasks.json         # Generated tasks
└── contexts/          # Persistent context files
    ├── research.md
    └── decisions.md
```

## Development Workflow

### Adding a New Tool

1. Create tool in `packages/opencode-hive/src/tools/`
2. Register in tool index
3. Add to agent system prompt if needed
4. Test with actual agent invocation

### Adding a New Skill

1. Create directory in `packages/opencode-hive/skills/<name>/`
2. Add `SKILL.md` with skill instructions
3. Register in skill loader
4. Document triggers in skill description

### Adding a Service

1. Create in `packages/hive-core/src/services/`
2. Export from `services/index.ts`
3. Add types to `types.ts`
4. Write unit tests

## Important Patterns

### File System Operations

Use the utility functions from hive-core:

```typescript
import { readJson, writeJson, fileExists, ensureDir } from './utils/fs.js';

// Not: fs.readFileSync + JSON.parse
const data = await readJson<Config>(path);

// Not: fs.mkdirSync
await ensureDir(dirPath);
```

### Error Handling

```typescript
// Prefer explicit error handling
try {
  const feature = await featureService.load(name);
  return { success: true, feature };
} catch (error) {
  return { 
    error: `Failed to load feature: ${error.message}`,
    hint: 'Check that the feature exists'
  };
}
```

### Path Resolution

```typescript
import { getHiveDir, getFeatureDir } from './utils/paths.js';

// Use path utilities, not string concatenation
const hivePath = getHiveDir(rootDir);
const featurePath = getFeatureDir(rootDir, featureName);
```

## Monorepo Structure

This is a **bun workspaces** monorepo:

```json
{
  "workspaces": ["packages/*"]
}
```

- Dependencies are hoisted to root `node_modules/`
- Each package has its own `package.json`

## Hive - Feature Development System

Plan-first development: Write plan → User reviews → Approve → Execute tasks

### Tools (18 total)

| Domain | Tools |
|--------|-------|
| Feature | hive_feature_create, hive_feature_complete |
| Plan | hive_plan_write, hive_plan_read, hive_plan_approve |
| Task | hive_tasks_sync, hive_task_create, hive_task_update |
| Worktree | hive_worktree_start, hive_worktree_create, hive_worktree_commit, hive_worktree_discard |
| Batch | hive_worktree_batch |
| Merge | hive_merge |
| Context | hive_context_write |
| AGENTS.md | hive_agents_md |
| Status | hive_status |
| Skill | hive_skill |

**Regular tools** (available to ALL agents, no filter):
- `explore_directory` — Structured directory tree overview with .gitignore filtering, binary detection, content preview
- `dora_*` — SCIP-based code analysis (symbol, references, file, cycles, unused)
- `look_at` — Smart file structure extractor for large files
- LSP tools — goto_definition, find_references, hover, rename, diagnostics

**Tool access is filtered per agent role (only `hive_*` tools are restricted):**
- **Hive** — all 18 tools (hybrid agent)
- **Swarm** — hive_feature_create, hive_feature_complete, hive_plan_read, hive_plan_approve, hive_tasks_sync, hive_task_create, hive_task_update, hive_worktree_start, hive_worktree_create, hive_worktree_discard, hive_worktree_batch, hive_merge, hive_context_write, hive_status, hive_skill, hive_agents_md (16 tools — excludes hive_worktree_commit, hive_plan_write)
- **Architect** — hive_feature_create, hive_plan_write, hive_plan_read, hive_context_write, hive_status, hive_skill (6 tools)
- **Forager** — hive_plan_read, hive_worktree_commit, hive_context_write, hive_skill (4 tools)
- **Scout** — hive_plan_read, hive_context_write, hive_status, hive_skill (4 tools)
- **Hygienic** — hive_plan_read, hive_context_write, hive_status, hive_skill (4 tools)
- **Project Initializer** — hive_plan_read, hive_context_write, hive_skill, hive_task_create, hive_worktree_start (5 tools)
- **Codebase Locator/Codebase Analyzer/Pattern Finder** — hive_plan_read, hive_skill (2 tools)

### Workflow

1. `hive_feature_create(name)` - Create feature
2. `hive_plan_write(content)` - Write plan.md
3. User adds comments in VSCode → `hive_plan_read` to see them
4. Revise plan → User approves
5. `hive_tasks_sync()` - Generate tasks from plan
6. `hive_worktree_start(task)` → work in worktree → `hive_worktree_commit(task, summary)`
7. `hive_merge(task)` - Merge task branch into main (when ready)

**Important:** `hive_worktree_commit` commits changes to task branch but does NOT merge.
Use `hive_merge` to explicitly integrate changes. Worktrees persist until manually removed.

### Batch Parallelism

Use `hive_worktree_batch` to start multiple independent tasks in parallel:

```
hive_worktree_batch({ tasks: ["01-task-a", "02-task-b"] })
```

After batch returns, check `openDelegations` in the response — each entry needs a `task()` call to spawn the forager worker:

```
task({ subagent_type: "forager-worker", ... })
```

When all workers complete, merge each task branch, then run full verification.

### Delegated Execution

`hive_worktree_start` creates worktree and spawns worker automatically (orchestrator must call `task()` after):

1. `hive_worktree_start(task)` → Creates worktree, returns `delegationRequired: true` with `taskToolCall`
2. Orchestrator calls `task({ subagent_type: "forager-worker", prompt: "@worker-prompt.md" })`
3. Worker executes → calls `hive_worktree_commit(status: "completed")`
4. Worker blocked → calls `hive_worktree_commit(status: "blocked", blocker: {...})`

**Handling blocked workers:**
1. Check blockers with `hive_status()`
2. Read the blocker info (reason, options, recommendation, context)
3. Ask user via `question()` tool - NEVER plain text
4. Resume with `hive_worktree_create(task, continueFrom: "blocked", decision: answer)`

**CRITICAL**: When resuming, a NEW worker spawns in the SAME worktree.
The previous worker's progress is preserved. Include the user's decision in the `decision` parameter.

**After task() Returns:**
- task() is BLOCKING — when it returns, the worker is DONE
- Call `hive_status()` immediately to check the new task state and find next runnable tasks
- No notifications or polling needed — the result is already available

### Sandbox Configuration

**Docker sandbox** provides isolated test environments for workers:

- **Config location**: `~/.config/opencode/agent_hive.json`
- **Fields**:
  - `sandbox: 'none' | 'docker'` — Isolation mode (default: 'none')
  - `dockerImage?: string` — Custom Docker image (optional, auto-detects if omitted)
- **Auto-detection**: Detects runtime from project files:
  - `package.json` → `node:22-slim`
  - `requirements.txt` / `pyproject.toml` → `python:3.12-slim`
  - `go.mod` → `golang:1.22-slim`
  - `Cargo.toml` → `rust:1.77-slim`
  - `Dockerfile` → builds from project Dockerfile
  - Fallback → `ubuntu:24.04`
- **Escape hatch**: Prefix commands with `HOST:` to bypass sandbox and run directly on host

**Example config**:
```json
{
  "sandbox": "docker",
  "dockerImage": "node:22-slim"
}
```

Workers are unaware of sandboxing — bash commands are transparently intercepted and wrapped with `docker run`.
