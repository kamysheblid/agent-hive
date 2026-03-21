# @hung319/opencode-hive

[![npm version](https://img.shields.io/npm/v/@hung319/opencode-hive)](https://www.npmjs.com/package/@hung319/opencode-hive)
[![License: MIT with Commons Clause](https://img.shields.io/badge/License-MIT%20with%20Commons%20Clause-blue.svg)](../../LICENSE)

**From Vibe Coding to Hive Coding** — The OpenCode plugin that brings structure to AI-assisted development.

## Why Hive?

Stop losing context. Stop repeating decisions. Start shipping with confidence.

```
Vibe: "Just make it work"
Hive: Plan → Review → Approve → Execute → Ship
```

## Quick Setup (3 Steps)

### For AI Agents (LLM)

```
1. Run: hive_doctor
2. Install missing: npm install <packages> && npx -y <tools>
3. Config: Add to ~/.config/opencode/agent_hive.json
```

### For Humans

**Step 1: Install the plugin**
```bash
npm install @hung319/opencode-hive
```

**Step 2: Check what's available**
Open OpenCode and ask: "Run hive_doctor to check the system"

**Step 3: Install extras you want**
- For **code analysis**: Install `@notprolands/ast-grep-mcp`
- For **fast code search**: Install `@paretools/search`
- For **code navigation**: Install `@butttons/dora`
- For **auto code review**: Install `auto-cr-cmd`

```bash
# Install all extras at once
npm install @notprolands/ast-grep-mcp @paretools/search
npx -y @butttons/dora auto-cr-cmd
```

**Step 4: Optional config**
Create `~/.config/opencode/agent_hive.json`:
```json
{
  "snip": { "enabled": true },
  "vectorMemory": { "enabled": true }
}
```

---

## Installation

```bash
npm install @hung319/opencode-hive
```

## Optional: Enable MCP Research Tools

1. Create `.opencode/mcp-servers.json` using the template:
   - From this repo: `packages/opencode-hive/templates/mcp-servers.json`
   - Or from npm: `node_modules/@hung319/opencode-hive/templates/mcp-servers.json`
2. Set `EXA_API_KEY` to enable `websearch_exa` (optional).
3. Restart OpenCode.

This enables tools like `grep_app_searchGitHub`, `context7_query-docs`, `websearch_web_search_exa`, and `ast_grep_search`.

## The Workflow

1. **Create Feature** — `hive_feature_create("dark-mode")`
2. **Write Plan** — AI generates structured plan
3. **Review** — You review in VS Code, add comments
4. **Approve** — `hive_plan_approve()`
5. **Execute** — Tasks run in isolated git worktrees
6. **Ship** — Clean commits, full audit trail

### Planning-mode delegation

During planning, "don't execute" means "don't implement" (no code edits, no worktrees). Read-only exploration is explicitly allowed and encouraged, both via local tools and by delegating to Scout.

#### Canonical Delegation Threshold

- Delegate to Scout when you cannot name the file path upfront, expect to inspect 2+ files, or the question is open-ended ("how/where does X work?").
- Local `read`/`grep`/`glob` is acceptable only for a single known file and a bounded question.

## Tools

### Feature Management
| Tool | Description |
|------|-------------|
| `hive_feature_create` | Create a new feature |
| `hive_feature_complete` | Mark feature as complete |

### Planning
| Tool | Description |
|------|-------------|
| `hive_plan_write` | Write plan.md |
| `hive_plan_read` | Read plan and comments |
| `hive_plan_approve` | Approve plan for execution |

### Tasks
| Tool | Description |
|------|-------------|
| `hive_tasks_sync` | Generate tasks from plan |
| `hive_task_create` | Create manual task |
| `hive_task_update` | Update task status/summary |

### Worktree
| Tool | Description |
|------|-------------|
| `hive_worktree_start` | Start normal work on task (creates worktree) |
| `hive_worktree_create` | Resume blocked task in existing worktree |
| `hive_worktree_commit` | Complete task (applies changes) |
| `hive_worktree_discard` | Abort task (discard changes) |

### Troubleshooting

#### Repeated blocked-resume errors / loop

If you see repeated retries around `continueFrom: "blocked"`, use this protocol:

1. Call `hive_status()` first.
2. If status is `pending` or `in_progress`, start normally with:
   - `hive_worktree_start({ feature, task })`
3. Only use blocked resume when status is exactly `blocked`:
   - `hive_worktree_create({ task, continueFrom: "blocked", decision })`

Do not retry the same blocked-resume call on non-blocked statuses; re-check `hive_status()` and use `hive_worktree_start` for normal starts.

#### Using with DCP plugin

When using Dynamic Context Pruning (DCP), use a Hive-safe config in `~/.config/opencode/dcp.jsonc`:

- `manualMode.enabled: true`
- `manualMode.automaticStrategies: false`
- `turnProtection.enabled: true` with `turnProtection.turns: 12`
- `tools.settings.nudgeEnabled: false`
- protect key tools in `tools.settings.protectedTools` (at least: `hive_status`, `hive_worktree_start`, `hive_worktree_create`, `hive_worktree_commit`, `hive_worktree_discard`, `question`)
- disable aggressive auto strategies:
  - `strategies.deduplication.enabled: false`
  - `strategies.supersedeWrites.enabled: false`
  - `strategies.purgeErrors.enabled: false`

For local plugin testing, keep OpenCode plugin entry as `"@hung319/opencode-hive"` (not `"@hung319/opencode-hive@latest"`).

## Prompt Budgeting & Observability

Hive automatically bounds worker prompt sizes to prevent context overflow and tool output truncation.

### Budgeting Defaults

| Limit | Default | Description |
|-------|---------|-------------|
| `maxTasks` | 10 | Number of previous tasks included |
| `maxSummaryChars` | 2,000 | Max chars per task summary |
| `maxContextChars` | 20,000 | Max chars per context file |
| `maxTotalContextChars` | 60,000 | Total context budget |

When limits are exceeded, content is truncated with `...[truncated]` markers and file path hints are provided so workers can read the full content.

### Observability

`hive_worktree_start` and blocked-resume `hive_worktree_create` output include metadata fields:

- **`promptMeta`**: Character counts for plan, context, previousTasks, spec, workerPrompt
- **`payloadMeta`**: JSON payload size, whether prompt is inlined or referenced by file
- **`budgetApplied`**: Budget limits, tasks included/dropped, path hints for dropped content
- **`warnings`**: Array of threshold exceedances with severity levels (info/warning/critical)

### Prompt Files

Large prompts are written to `.hive/features/<feature>/tasks/<task>/worker-prompt.md` and passed by file reference (`workerPromptPath`) rather than inlined in tool output. This prevents truncation of large prompts.

## Plan Format

```markdown
# Feature Name

## Overview
What we're building and why.

## Tasks

### 1. Task Name
Description of what to do.

### 2. Another Task
Description.
```

## Configuration

Hive uses a config file at `~/.config/opencode/agent_hive.json`. You can customize agent models, variants, disable skills, and disable MCP servers.

### Disable Skills or MCPs

```json
{
  "$schema": "https://raw.githubusercontent.com/hung319/agent-hive/main/packages/opencode-hive/schema/agent_hive.schema.json",
  "disableSkills": ["brainstorming", "writing-plans"],
  "disableMcps": ["websearch", "ast_grep"]
}
```

#### Available Skills

| ID | Description |
|----|-------------|
| `brainstorming` | Use before any creative work. Explores user intent, requirements, and design through collaborative dialogue before implementation. |
| `writing-plans` | Use when you have a spec or requirements for a multi-step task. Creates detailed implementation plans with bite-sized tasks. |
| `executing-plans` | Use when you have a written implementation plan. Executes tasks in batches with review checkpoints. |
| `dispatching-parallel-agents` | Use when facing 2+ independent tasks. Dispatches multiple agents to work concurrently on unrelated problems. |
| `test-driven-development` | Use when implementing any feature or bugfix. Enforces write-test-first, red-green-refactor cycle. |
| `systematic-debugging` | Use when encountering any bug or test failure. Requires root cause investigation before proposing fixes. |
| `code-reviewer` | Use when reviewing implementation changes against an approved plan or task to catch missing requirements, YAGNI, dead code, and risky patterns. |
| `verification-before-completion` | Use before claiming work is complete. Requires running verification commands and confirming output before success claims. |

#### Available MCPs

| ID | Description | Requirements |
|----|-------------|--------------|
| `websearch` | Web search via [Exa AI](https://exa.ai). Real-time web searches and content scraping. | Set `EXA_API_KEY` env var |
| `context7` | Library documentation lookup via [Context7](https://context7.com). Query up-to-date docs for any programming library. | None |
| `grep_app` | GitHub code search via [grep.app](https://grep.app). Find real-world code examples from public repositories. | None |
| `ast_grep` | Native NAPI-powered AST analysis. Pattern matching across 25+ languages. | Built-in (no npx needed) |
| `pare_search` | Structured ripgrep/fd search with 65-95% token reduction. | None (runs via npx) |

#### Native ast-grep Tools

Instead of MCP-based ast-grep, this plugin includes native tools using `@ast-grep/napi`:

| Tool | Description |
|------|-------------|
| `ast_grep_dump_syntax_tree` | Dump code's syntax structure for debugging |
| `ast_grep_test_match_code_rule` | Test code against YAML rules |
| `ast_grep_find_code` | Find code matching patterns in project |
| `ast_grep_scan_code` | Scan for TypeScript bugs and best practices |
| `ast_grep_rewrite_code` | Transform/refactor code with AST patterns |
| `ast_grep_analyze_imports` | Analyze import usage in codebase |

### Per-Agent Skills

Each agent can have specific skills enabled. If configured, only those skills appear in `hive_skill()`:

```json
{
  "agents": {
    "hive": {
      "skills": ["brainstorming", "writing-plans", "executing-plans"]
    },
    "forager-worker": {
      "skills": ["test-driven-development", "verification-before-completion"]
    }
  }
}
```

**How `skills` filtering works:**

| Config | Result |
|--------|--------|
| `skills` omitted | All skills enabled (minus global `disableSkills`) |
| `skills: []` | All skills enabled (minus global `disableSkills`) |
| `skills: ["tdd", "debug"]` | Only those skills enabled |

Note: Wildcards like `["*"]` are **not supported** - use explicit skill names or omit the field entirely for all skills.

### Auto-load Skills

Use `autoLoadSkills` to automatically inject skills into an agent's system prompt at session start.

```json
{
  "$schema": "https://raw.githubusercontent.com/hung319/agent-hive/main/packages/opencode-hive/schema/agent_hive.schema.json",
  "agents": {
    "hive": {
      "autoLoadSkills": ["parallel-exploration"]
    },
    "forager-worker": {
      "autoLoadSkills": ["test-driven-development", "verification-before-completion"]
    }
  }
}
```

**Supported skill sources:**

`autoLoadSkills` accepts both Hive builtin skill IDs and file-based skill IDs. Resolution order:

1. **Hive builtin** — Skills bundled with opencode-hive (always win if ID matches)
2. **Project OpenCode** — `<project>/.opencode/skills/<id>/SKILL.md`
3. **Global OpenCode** — `~/.config/opencode/skills/<id>/SKILL.md`
4. **Project Claude** — `<project>/.claude/skills/<id>/SKILL.md`
5. **Global Claude** — `~/.claude/skills/<id>/SKILL.md`

Skill IDs must be safe directory names (no `/`, `\`, `..`, or `.`). Missing or invalid skills emit a warning and are skipped—startup continues without failure.

**How `skills` and `autoLoadSkills` interact:**

- `skills` controls what appears in `hive_skill()` — the agent can manually load these on demand
- `autoLoadSkills` injects skills unconditionally at session start — no manual loading needed
- These are **independent**: a skill can be auto-loaded but not appear in `hive_skill()`, or vice versa
- User `autoLoadSkills` are **merged** with defaults (use global `disableSkills` to remove defaults)

**Default auto-load skills by agent:**

| Agent | autoLoadSkills default |
|-------|------------------------|
| `hive` | `parallel-exploration` |
| `forager-worker` | `test-driven-development`, `verification-before-completion` |
| `scout-researcher` | (none) |
| `architect-planner` | `parallel-exploration` |
| `swarm-orchestrator` | (none) |

### Per-Agent Model Variants

You can set a `variant` for each Hive agent to control model reasoning/effort level. Variants are keys that map to model-specific option overrides defined in your `opencode.json`.

```json
{
  "$schema": "https://raw.githubusercontent.com/hung319/agent-hive/main/packages/opencode-hive/schema/agent_hive.schema.json",
  "agents": {
    "hive": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "variant": "high"
    },
    "forager-worker": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "variant": "medium"
    },
    "scout-researcher": {
      "variant": "low"
    }
  }
}
```

The `variant` value must match a key in your OpenCode config at `provider.<provider>.models.<model>.variants`. For example, with Anthropic models you might configure thinking budgets:

```json
// opencode.json
{
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-4-20250514": {
          "variants": {
            "low": { "thinking": { "budget_tokens": 5000 } },
            "medium": { "thinking": { "budget_tokens": 10000 } },
            "high": { "thinking": { "budget_tokens": 25000 } }
          }
        }
      }
    }
  }
}
```

**Precedence:** If a prompt already has an explicit variant set, the per-agent config acts as a default and will not override it. Invalid or missing variant keys are treated as no-op (the model runs with default settings).

### Custom Derived Subagents

Define plugin-only custom subagents with `customAgents`. Freshly initialized `agent_hive.json` files already include starter template entries under `customAgents`; those seeded `*-example-template` entries are placeholders only, should be renamed or deleted before real use, and are intentionally worded so planners/orchestrators are unlikely to select them as configured. Each custom agent must declare:

- `baseAgent`: one of `forager-worker` or `hygienic-reviewer`
- `description`: delegation guidance injected into primary planner/orchestrator prompts

Published example (validated by `src/e2e/custom-agent-docs-example.test.ts`):

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

Inheritance rules when a custom agent field is omitted:

| Field | Inheritance behavior |
|-------|----------------------|
| `model` | Inherits resolved base agent model (including user overrides in `agents`) |
| `temperature` | Inherits resolved base agent temperature |
| `variant` | Inherits resolved base agent variant |
| `autoLoadSkills` | Merges with base agent auto-load defaults/overrides, de-duplicates, and applies global `disableSkills` |

ID guardrails:

- `customAgents` keys cannot reuse built-in Hive agent IDs
- plugin-reserved aliases are blocked (`hive`, `architect`, `swarm`, `scout`, `forager`, `hygienic`, `receiver`)
- operational IDs are blocked (`build`, `plan`, `code`)

### Custom Models

Override models for specific agents:

```json
{
  "agents": {
    "hive": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.5
    }
  }
}
```

## Agent Booster Tools

Ultra-fast code editing powered by Rust+WASM. **52x faster than Morph LLM, FREE (no API key required).**

### Tools

| Tool | Description |
|------|-------------|
| `hive_code_edit` | Ultra-fast code editing with automatic fallback |
| `hive_lazy_edit` | Edit with `// ... existing code ...` markers |
| `hive_booster_status` | Check agent-booster availability |

### Usage

```typescript
// Edit with old/new content
hive_code_edit({
  path: "src/index.ts",
  oldContent: "const old = 'value';",
  newContent: "const new = 'updated';"
})
```

### Lazy Edit Example

```typescript
// Use markers for partial code
hive_lazy_edit({
  path: "src/component.tsx",
  snippet: `// ... existing code ...
export const newFeature = () => { ... };
// ... existing code ...`
})
```

### Configuration

```json
{
  "agentBooster": {
    "enabled": false,
    "serverUrl": "http://localhost:3001",
    "serverPort": 3001
  }
}
```

## Vector Memory Tools

Semantic memory search powered by HNSW indexing. Find memories by meaning, not just keywords.

### Tools

| Tool | Description |
|------|-------------|
| `hive_vector_search` | Semantic search across memories |
| `hive_vector_add` | Add memory with vector indexing |
| `hive_vector_status` | Check vector memory status |

### Memory Types

- `decision`: Architectural decisions, design choices
- `learning`: Insights, discoveries, patterns found
- `preference`: User preferences, coding style
- `blocker`: Known blockers, workarounds
- `context`: Important context about the project
- `pattern`: Code patterns, recurring solutions

### Usage

```typescript
// Add a memory
hive_vector_add({
  content: "Use async/await instead of .then() chains",
  type: "learning",
  scope: "async-patterns",
  tags: ["javascript", "best-practice"]
})

// Search memories
hive_vector_search({
  query: "async patterns JavaScript",
  type: "learning",
  limit: 10
})
```

### Configuration

```json
{
  "vectorMemory": {
    "enabled": false,
    "indexPath": "~/.config/opencode/hive/vector-index",
    "dimensions": 384
  }
}
```

## Hive Doctor

System health check with actionable fixes. Run this when setting up or troubleshooting.

### Tools

| Tool | Description |
|------|-------------|
| `hive_doctor` | Full health check with install commands |
| `hive_doctor_quick` | Quick status summary |

### Usage

```typescript
// Full health check with actionable output
hive_doctor()

// Quick status
hive_doctor_quick()
```

### What it checks

1. **Dependencies** - npm packages installed?
   - `@ast-grep/napi` - Native AST analysis
   - `@sparkleideas/agent-booster` - Fast code editing
   - `@sparkleideas/memory` - Vector memory
   - `@paretools/search` - Structured search
   - `@upstash/context7-mcp` - Library docs
   - `exa-mcp-server` - Web search

2. **CLI Tools** - npx tools available?
   - `dora` - Code navigation (SCIP-based)
   - `auto-cr` - Automated code review (SWC)
   - `scip-typescript` - TypeScript indexer
   - `veil` - Code discovery

3. **Native Binaries** - @ast-grep/napi tree-sitter?
   - Native mode: Fastest, uses compiled binaries
   - CLI mode: Falls back to MCP via npx

4. **Config** - Features enabled?
   - snip, vectorMemory, agentBooster
   - sandbox mode
   - MCPs: ast_grep, veil, pare_search

### Example Output

```json
{
  "status": "warning",
  "summary": {
    "dependencies": "⚠️ 2 missing: agent-booster, vector-memory",
    "cliTools": "⚠️ 1 missing: auto-cr",
    "nativeBinaries": "⚡ CLI mode (native unavailable)",
    "config": "💡 2 disabled: snip, vectorMemory"
  },
  "actionItems": [
    {
      "priority": "high",
      "action": "Install auto-cr",
      "command": "npx -y auto-cr-cmd",
      "reason": "SWC-based automated code review"
    },
    {
      "priority": "medium",
      "action": "Install agent-booster",
      "command": "npm install @sparkleideas/agent-booster",
      "reason": "52x faster code editing"
    }
  ],
  "quickInstall": {
    "deps": ["@sparkleideas/agent-booster", "@sparkleideas/memory"],
    "cliTools": ["auto-cr-cmd"]
  }
}
```

### Setup Workflow

**For AI Agents (LLM):**

```
1. Run: hive_doctor
2. Parse: actionItems[] for priority: "high"
3. Install: Run quickInstall.commands
4. Config: Apply config recommendations
5. Verify: Run hive_doctor again to confirm
```

**For Humans:**

1. **Open OpenCode** and ask "Run hive_doctor"
2. **Look at the summary** - it tells you what's missing
3. **Install what you need** - commands are ready to copy
4. **Optional: Configure** - enable snip, vector memory for extra features

```
Quick Install All:
npm install @notprolands/ast-grep-mcp @paretools/search @sparkleideas/memory
npx -y @butttons/dora auto-cr-cmd
```
```

## License

MIT with Commons Clause — Free for personal and non-commercial use. See [LICENSE](../../LICENSE) for details.

---

**Stop vibing. Start hiving.** 🐝
