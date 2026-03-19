/**
 * Test for built-in agent demotion - Debug version
 * 
 * This test verifies that OpenCode's built-in agents (build, plan, etc.)
 * are properly demoted to subagent mode so that zetta becomes the primary agent.
 * 
 * Run this in OpenCode to verify the fix:
 *   bun test /path/to/test-builtin-agent-demotion.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import plugin from "../index";

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: "http://localhost:1" });

const TEST_ROOT_BASE = "/tmp/hive-builtin-agent-test";

function createProject(worktree: string) {
  return {
    id: "test",
    worktree,
    time: { created: Date.now() },
  };
}

describe("Built-in Agent Demotion (Debug)", () => {
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

  it("should demote build and plan to subagent mode when agent config is undefined", async () => {
    // Setup agent_hive.json
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agentMode: "unified" }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    
    // Simulate opencodeConfig with NO agent section
    const opencodeConfig: any = { agent: undefined };
    await hooks.config!(opencodeConfig);

    // LOG for debugging
    console.log("=== DEBUG: agent config after hook ===");
    console.log(JSON.stringify(opencodeConfig.agent, null, 2));
    console.log("default_agent:", opencodeConfig.default_agent);

    // Verify build is demoted
    expect(opencodeConfig.agent["build"]).toBeDefined();
    expect(opencodeConfig.agent["build"].mode).toBe("subagent");

    // Verify plan is demoted
    expect(opencodeConfig.agent["plan"]).toBeDefined();
    expect(opencodeConfig.agent["plan"].mode).toBe("subagent");

    // Verify zetta is primary
    expect(opencodeConfig.agent["zetta"]).toBeDefined();
    expect(opencodeConfig.default_agent).toBe("zetta");
  });

  it("should demote build and plan when agent config exists but is empty", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agentMode: "unified" }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    
    // Simulate opencodeConfig with EMPTY agent section
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    console.log("=== DEBUG: empty agent config ===");
    console.log(JSON.stringify(opencodeConfig.agent, null, 2));

    expect(opencodeConfig.agent["build"].mode).toBe("subagent");
    expect(opencodeConfig.agent["plan"].mode).toBe("subagent");
    expect(opencodeConfig.default_agent).toBe("zetta");
  });

  it("should demote all built-in agents: build, plan, triage, docs, ask", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ agentMode: "unified" }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: undefined };
    await hooks.config!(opencodeConfig);

    console.log("=== DEBUG: all built-in agents ===");
    const builtInAgents = ["build", "plan", "triage", "docs", "ask", "claude-code"];
    for (const agent of builtInAgents) {
      console.log(`${agent}: mode = ${opencodeConfig.agent[agent]?.mode}`);
      expect(opencodeConfig.agent[agent]).toBeDefined();
      expect(opencodeConfig.agent[agent].mode).toBe("subagent");
    }
  });
});
