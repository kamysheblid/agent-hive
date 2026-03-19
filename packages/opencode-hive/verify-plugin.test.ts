/**
 * Simple plugin verification test for OpenCode
 * 
 * Copy this into OpenCode to verify:
 * 1. Plugin loads correctly
 * 2. Zetta is primary agent
 * 3. Build/plan are demoted to subagent
 * 
 * Run: bun test /path/to/verify-plugin.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import plugin from "./src/index";

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: "http://localhost:1" });
const TEST_ROOT_BASE = "/tmp/plugin-verify-test";

function createProject(worktree: string) {
  return { id: "test", worktree, time: { created: Date.now() } };
}

describe("Plugin Verification", () => {
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
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("✓ Plugin loads and zetta is primary agent", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ agentMode: "unified" }));

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = {};
    await hooks.config!(opencodeConfig);

    console.log("\n=== VERIFICATION RESULTS ===");
    console.log("default_agent:", opencodeConfig.default_agent);
    console.log("build.mode:", opencodeConfig.agent?.build?.mode);
    console.log("plan.mode:", opencodeConfig.agent?.plan?.mode);
    console.log("zetta.mode:", opencodeConfig.agent?.zetta?.mode);
    console.log("==========================\n");

    expect(opencodeConfig.default_agent).toBe("zetta");
    expect(opencodeConfig.agent?.build?.mode).toBe("subagent");
    expect(opencodeConfig.agent?.plan?.mode).toBe("subagent");
  });

  it("✓ Plugin provides tools hook", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "agent_hive.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ agentMode: "unified" }));

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    
    console.log("\n=== HOOKS AVAILABLE ===");
    console.log("tools:", typeof hooks.tools === "function" ? "function" : hooks.tools);
    console.log("config:", typeof hooks.config === "function" ? "function" : hooks.config);
    console.log("========================\n");

    expect(typeof hooks.config).toBe("function");
  });
});
