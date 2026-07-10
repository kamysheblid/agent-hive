# @hung319/opencode-hive

[![npm version](https://img.shields.io/npm/v/@hung319/opencode-hive)](https://www.npmjs.com/package/@hung319/opencode-hive)
[![License: MIT with Commons Clause](https://img.shields.io/badge/License-MIT%20with%20Commons%20Clause-blue.svg)](../../LICENSE)

**From Vibe Coding to Hive Coding** — The OpenCode plugin for plan-first, structured AI-assisted development with multi-agent orchestration.

---

## Quick Start

Add `@hung319/opencode-hive` to your `opencode.json`:

```json
{
  "plugin": ["@hung319/opencode-hive"]
}
```

That's it. On first load, Hive auto-installs:
- **Agent Tools**: `@sparkleideas/agent-booster` (52x faster code editing), `@sparkleideas/memory` (vector memory)
- **CLI Tools**: `dora` (SCIP code navigation), `auto-cr-cmd` (automated code review), `btca` (Bluetooth Classic Audio)
- **Snip binary**: 60-90% token reduction by filtering shell output

All tools fall back gracefully if installation fails — nothing breaks.

---

## Configuration

Auto-generated at `~/.config/opencode/agent_hive.json`. A complete config looks like this — copy it as a starting point:

```json
{
  "agentMode": "unified",
  "executionMode": "parallel",
  "agents": {
    "hive": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.5 }
  }
}
```

### Sequential Execution Mode (run workers one at a time)

By default (`"parallel"`) `hive_worktree_batch` launches every worker agent at once. On machines with limited VRAM — or when you want each worker's result before the next starts — set `"sequential"` instead.

**To enable it, set the file to:**

```json
{
  "executionMode": "sequential"
}
```

That is the entire file if none exists yet. If you already have a config, just add the `"executionMode"` line. After saving, restart OpenCode — no install or build step needed.

**Behavior in sequential mode:**
- Only **one** worker starts at a time.
- After it finishes, the orchestrator automatically starts the next.
- If a worker fails, everything stops — no further workers launch.
- Switch back anytime by changing `"sequential"` to `"parallel"` (or deleting the line).

| Option | Default | Description |
|---|---|---|
| `agentMode` | `unified` | `dedicated` splits planner + orchestrator into separate agents |
| `disableSkills` | `[]` | Globally hide skills from `hive_skill()` |
| `disableMcps` | `[]` | Globally disable MCP servers |
| `executionMode` | `parallel` | `sequential` runs `hive_worktree_batch` worker agents one at a time (lower VRAM); `parallel` spawns all at once |

### Agent Models & Variants

```json
{
  "agents": {
    "hive": { "model": "anthropic/claude-sonnet-4-20250514", "variant": "high" },
    "scout-researcher": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.5 },
    "forager-worker": { "model": "anthropic/claude-sonnet-4-20250514", "variant": "medium" },
    "hygienic-reviewer": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.3 }
  }
}
```

Variants map to model-specific settings in your `opencode.json` (e.g., Anthropic thinking budgets).

### Custom Derived Subagents

Define derived agents from `forager-worker` or `hygienic-reviewer`:

```json
{
  "agents": {
    "forager-worker": {
      "variant": "medium"
    },
    "hygienic-reviewer": {
      "model": "github-copilot/gpt-5.2-codex"
    }
  },
  "customAgents": {
    "forager-ui": {
      "baseAgent": "forager-worker",
      "description": "Use for UI-heavy implementation tasks.",
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.2,
      "variant": "high"
    },
    "reviewer-security": {
      "baseAgent": "hygienic-reviewer",
      "description": "Use for security-focused review passes."
    }
  }
}
```

Omitted fields (`model`, `variant`, `temperature`) inherit from the base agent. `autoLoadSkills` merges with base defaults, de-duplicates, and applies global `disableSkills`. Custom agent IDs cannot reuse built-in Hive names or reserved plugin IDs.

### Skills

| ID | Use Case |
|---|---|
| `brainstorming` | Explore requirements before implementation |
| `writing-plans` | Create detailed implementation plans |
| `executing-plans` | Execute tasks in batches with review checkpoints |
| `dispatching-parallel-agents` | Dispatch 2+ agents for independent work |
| `test-driven-development` | Red-green-refactor cycle |
| `systematic-debugging` | Root cause investigation before fixes |
| `code-reviewer` | Review changes against plan |
| `verification-before-completion` | Verify before claiming done |
| `docker-mastery` | Docker container debugging and optimization |

**Per-agent filtering:** `{ "agents": { "forager-worker": { "skills": ["tdd", "verification-before-completion"] } } }`

**Auto-load skills:** Use `autoLoadSkills` to inject skills into agent prompts at session start:

```json
{
  "agents": {
    "hive": { "autoLoadSkills": ["parallel-exploration"] }
  }
}
```

Resolution order: Hive builtin → Project OpenCode → Global OpenCode → Project Claude → Global Claude.

### MCP Servers

| MCP | Tool | Requires |
|---|---|---|
| `websearch` | `websearch_web_search_exa` | `EXA_API_KEY` env |
| `context7` | `context7_query-docs` | None |
| `grep_app` | `grep_app_searchGitHub` | None |


---

## Tools

| Category | Tools |
|---|---|
| **Feature** | `hive_feature_create`, `hive_feature_complete` |
| **Plan** | `hive_plan_write`, `hive_plan_read`, `hive_plan_approve` |
| **Task** | `hive_tasks_sync`, `hive_task_create`, `hive_task_update` |
| **Worktree** | `hive_worktree_batch`, `hive_worktree_start`, `hive_worktree_create`, `hive_worktree_commit`, `hive_worktree_discard` |
| **Merge** | `hive_merge` |
| **Context** | `hive_context_write` |
| **Memory** | `hive_memory_*`, `hive_vector_*` |
| **Code** | `hive_code_edit`, `hive_lazy_edit`, `hive_booster_status` |
| **Other** | `hive_status`, `hive_skill`, `hive_agents_md` |

### Planning-mode delegation

During planning, "don't execute" means "don't implement" (no code edits, no worktrees). Read-only exploration is explicitly allowed and encouraged, both via local tools and by delegating to Scout.

#### Canonical Delegation Threshold

- Delegate to Scout when you cannot name the file path upfront, expect to inspect 2+ files, or the question is open-ended ("how/where does X work?").
- Local `read`/`grep`/`glob` is acceptable only for a single known file and a bounded question.

---

## Agent Booster (Ultra-Fast Code Editing)

Rust+WASM powered — 52x faster than Morph LLM, no API key needed.

```typescript
hive_code_edit({
  path: "src/index.ts",
  oldContent: "const old = 'value';",
  newContent: "const new = 'updated';"
})
```

## Vector Memory (Semantic Search)

HNSW indexing for semantic memory search:

```typescript
hive_vector_add({
  content: "Use async/await instead of .then() chains",
  type: "learning",
  tags: ["javascript", "best-practice"]
})

hive_vector_search({ query: "async patterns", type: "learning", limit: 10 })
```

## Prompt Budgeting

Hive bounds worker prompts to prevent context overflow. Defaults: 10 tasks, 2K chars per summary, 20K per context file, 60K total. Exceeded content is truncated with `...[truncated]` markers and file path hints.

## Troubleshooting

If a task gets stuck in a blocked-resume loop:
1. Call `hive_status()` first
2. If `pending`/`in_progress`: `hive_worktree_start({ feature, task })`
3. Only use `hive_worktree_create({ task, continueFrom: "blocked", decision })` when status is exactly `blocked`

---

## License

MIT with Commons Clause — Free for personal and non-commercial use. See [LICENSE](../../LICENSE) for details.
