# Agent Hive 🐝

**From Vibe Coding to Hive Coding** — Plan first. Execute with trust. Context persists.

[![npm version](https://img.shields.io/npm/v/@hung319/opencode-hive.svg)](https://www.npmjs.com/package/@hung319/opencode-hive)
[![License: MIT with Commons Clause](https://img.shields.io/badge/License-MIT%20with%20Commons%20Clause-blue.svg)](LICENSE)

---

## The Problem

Vibe coding is powerful but chaotic without structure: context lost between sessions, subagents conflict, scope spirals, and no audit trail exists when things go wrong.

## The Solution

| Pain Point | Hive Fix |
|---|---|
| Lost context | Feature-scoped knowledge in `.hive/` survives sessions |
| Subagent chaos | Batch parallelism with context flow between batches |
| Scope creep | Plan approval gate — human shapes, agent builds |
| No audit trail | Every task, decision, and change logged automatically |

**Hive doesn't change how you work. It makes what happens traceable, auditable, and grounded.**

---

## Quick Start

Add `@hung319/opencode-hive` to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@hung319/opencode-hive"]
}
```

OpenCode handles the rest — no manual install needed. On first load, Hive auto-installs all dependencies (snip binary for token reduction, agent-booster for fast editing, CLI tools for code navigation).

## The Workflow

```
  PLAN      →   REVIEW      →   EXECUTE      →   SHIP
Chat with     See plan in      Tasks run in    Clean merges,
your agent    VS Code sidebar  isolated        full audit trail
about what    Add comments,    worktrees       Context persists
to build      refine, approve  in parallel     for next time
```

## Core Configuration

Auto-generated at `~/.config/opencode/agent_hive.json` after first run. A complete config looks like this — copy it as a starting point:

```json
{
  "agentMode": "unified",
  "executionMode": "parallel",
  "agents": {
    "hive": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.5, "top_p": 0.95, "top_k": 40 }
  }
}
```

| Option | Values | Description |
|---|---|---|
| `agentMode` | `unified`, `dedicated` | Single agent or separate planner + orchestrator |
| `disableSkills` | `string[]` | Globally disable skills |
| `disableMcps` | `string[]` | Globally disable MCP servers |
| `executionMode` | `parallel`, `sequential` | `sequential` runs `hive_worktree_batch` worker agents one at a time (lower VRAM); `parallel` spawns all at once |
| `top_p` | 0–1 | Nucleus sampling threshold per agent (omit for provider default) |
| `top_k` | integer ≥ 0 | Top-k token limit per agent (omit for provider default) |

---

## Environment Variables

| Variable | Required For |
|---|---|
| `EXA_API_KEY` | Web search via Exa AI |
| `SEARXNG_URL` | Privacy meta-search (self-hosted SearXNG) |

---

## How It Works

Hive runs as an OpenCode plugin with specialized agents:

| Agent | Role |
|---|---|
| **Hive** 👑 | Plans + orchestrates, phase-aware |
| **Scout** 🔍 | Explores codebase + external docs |
| **Forager** 🍯 | Implements tasks in isolated worktrees |
| **Hygienic** 🧹 | Reviews plan/code quality |

Workflow: Plan → Approve → Execute (batched parallelism) → Ship.

---

## Why Hive?

- **Plan First** — Human owns the _what_, agent owns the _how_. Approval gate builds trust.
- **Batched Parallelism** — Independent tasks run concurrently. Sequential batches share context.
- **Context Persists** — Calibration survives sessions. The "3 months later" problem solved.
- **Good Enough Wins** — Ship working code. Iterate later. Reject over-engineering.

---

## Packages

| Package | Description |
|---|---|
| [@hung319/opencode-hive](https://www.npmjs.com/package/@hung319/opencode-hive) | OpenCode plugin — 6 agents, 17 tools, 12 skills |

See [packages/opencode-hive/README.md](packages/opencode-hive/README.md) for full tool reference, configuration, agent setup, and usage details.

---

## License

MIT with Commons Clause — Free for personal and non-commercial use. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Stop vibing. Start hiving.</strong> 🐝
  <br>
  <em>Plan first. Execute with trust. Context persists.</em>
</p>
