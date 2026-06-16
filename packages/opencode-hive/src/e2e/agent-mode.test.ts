import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import plugin from "../index";

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: "http://localhost:1" });

const TEST_ROOT_BASE = "/tmp/hive-agent-mode-test";

function createProject(worktree: string) {
  return {
    id: "test",
    worktree,
    time: { created: Date.now() },
  };
}

describe("agentMode gating", () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT_BASE, { recursive: true });
    testRoot = fs.mkdtempSync(path.join(TEST_ROOT_BASE, "project-"));
    process.env.HOME = testRoot;
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it("registers hive, scout, forager, and hygienic in unified mode", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    expect(opencodeConfig.agent["zetta"]).toBeDefined();
    expect(opencodeConfig.agent["architect-planner"]).toBeUndefined();
    expect(opencodeConfig.agent["swarm-orchestrator"]).toBeUndefined();
    expect(opencodeConfig.agent["scout-researcher"]).toBeDefined();
    expect(opencodeConfig.agent["forager-worker"]).toBeDefined();
    expect(opencodeConfig.agent["hygienic-reviewer"]).toBeDefined();
    expect(opencodeConfig.default_agent).toBe("zetta");
  });

  it("registers dedicated agents in dedicated mode", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "dedicated",
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    expect(opencodeConfig.agent["zetta"]).toBeDefined();
    expect(opencodeConfig.agent["scout-researcher"]).toBeDefined();
    expect(opencodeConfig.agent["forager-worker"]).toBeDefined();
    expect(opencodeConfig.agent["hygienic-reviewer"]).toBeDefined();
    expect(opencodeConfig.agent["codebase-locator"]).toBeDefined();
    expect(opencodeConfig.agent["codebase-analyzer"]).toBeDefined();
    expect(opencodeConfig.default_agent).toBe("zetta");
  });

  it("injects custom-subagent appendix into dedicated-mode primary prompts and registers custom agents", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "dedicated",
        customAgents: {
          "forager-ui": {
            baseAgent: "forager-worker",
            description: "Use for UI-heavy implementation tasks.",
            autoLoadSkills: [],
          },
          "reviewer-security": {
            baseAgent: "hygienic-reviewer",
            description: "Use for security-focused review passes.",
            autoLoadSkills: [],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    expect(opencodeConfig.agent["forager-ui"]).toBeDefined();
    expect(opencodeConfig.agent["reviewer-security"]).toBeDefined();

    const zettaPrompt = opencodeConfig.agent["zetta"]?.prompt as string;
    expect(zettaPrompt).toContain("## Configured Custom Subagents");
    expect(zettaPrompt).toContain("forager-ui");
    expect(zettaPrompt).toContain("reviewer-security");
  });

  it("demotes built-in agents (build, plan) to subagent mode even when no agent config exists", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    // Test with NO existing agent config (empty object means no agent section)
    const opencodeConfig: any = { agent: undefined };
    await hooks.config!(opencodeConfig);

    // Verify built-in agents are demoted to subagent mode
    expect(opencodeConfig.agent["build"]).toBeDefined();
    expect((opencodeConfig.agent["build"] as any).mode).toBe("subagent");
    expect(opencodeConfig.agent["plan"]).toBeDefined();
    expect((opencodeConfig.agent["plan"] as any).mode).toBe("subagent");
    
    // Verify zetta is the default agent
    expect(opencodeConfig.default_agent).toBe("zetta");
    
    // Verify zetta is registered as primary (no mode = primary)
    expect(opencodeConfig.agent["zetta"]).toBeDefined();
    expect((opencodeConfig.agent["zetta"] as any).mode).toBeUndefined();
  });
});
