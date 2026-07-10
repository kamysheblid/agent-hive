import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { PluginInput } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk";
import plugin from "../index";

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: "http://localhost:1" }) as unknown as PluginInput["client"];

const TEST_ROOT_BASE = "/tmp/hive-e2e-sequential";

function createStubShell(): PluginInput["$"] {
  const fn = ((..._args: unknown[]) => {
    throw new Error("shell not available in this test");
  }) as unknown as PluginInput["$"];

  return Object.assign(fn, {
    braces(pattern: string) {
      return [pattern];
    },
    escape(input: string) {
      return input;
    },
    env() {
      return fn;
    },
    cwd() {
      return fn;
    },
    nothrow() {
      return fn;
    },
    throws() {
      return fn;
    },
  });
}

function createToolContext(sessionID: string) {
  return {
    sessionID,
    messageID: "msg_test",
    agent: "test",
    abort: new AbortController().signal,
  };
}

function createProject(worktree: string): PluginInput["project"] {
  return {
    id: "test",
    worktree,
    time: { created: Date.now() },
  };
}

function makeCtx(root: string): PluginInput {
  return {
    directory: root,
    worktree: root,
    serverUrl: new URL("http://localhost:1"),
    project: createProject(root),
    client: OPENCODE_CLIENT,
    $: createStubShell(),
  };
}

function writeConfig(root: string, config: Record<string, unknown>) {
  const configPath = path.join(root, ".config", "opencode", "agent_hive.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config));
}

describe("e2e: sequential execution mode", () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT_BASE, { recursive: true });
    testRoot = fs.mkdtempSync(path.join(TEST_ROOT_BASE, "project-"));
    process.env.HOME = testRoot;

    execSync("git init", { cwd: testRoot });
    execSync('git config user.email "test@example.com"', { cwd: testRoot });
    execSync('git config user.name "Test"', { cwd: testRoot });
    fs.writeFileSync(path.join(testRoot, "README.md"), "smoke test");
    execSync("git add README.md", { cwd: testRoot });
    execSync('git commit -m "init"', { cwd: testRoot });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  const setupFeature = async (hooks: any, toolContext: any, featureName: string): Promise<string[]> => {
    await hooks.tool!.hive_feature_create.execute({ name: featureName }, toolContext);
    const plan = `# Sequential Feature

## Discovery

**Q: What is the goal of this feature?**
A: Validate that hive_worktree_batch honors the executionMode config. In sequential mode it must return one delegation at a time with a resume cursor; in parallel mode it returns all delegations at once via Promise.all.

**Q: How is the mode selected?**
A: Via the executionMode key in ~/.config/opencode/agent_hive.json, defaulting to parallel when unset or when the file is absent.

## Tasks

### 1. First Task
Do first

**Depends on**: none

### 2. Second Task
Do second

**Depends on**: none
`;
    await hooks.tool!.hive_plan_write.execute({ content: plan, feature: featureName }, toolContext);
    await hooks.tool!.hive_plan_approve.execute({ feature: featureName }, toolContext);
    await hooks.tool!.hive_tasks_sync.execute({ feature: featureName }, toolContext);
    const statusRaw = await hooks.tool!.hive_status.execute({ feature: featureName }, toolContext);
    const status = JSON.parse(statusRaw as string) as {
      tasks?: { list?: Array<{ folder: string }> };
    };
    return (status.tasks?.list ?? []).map((t) => t.folder);
  };

  it("parallel (default) returns all delegations at once via Promise.all", async () => {
    const hooks = await plugin(makeCtx(testRoot));
    const tc = createToolContext("sess_parallel");
    const folders = await setupFeature(hooks, tc, "parallel-feature");
    expect(folders.length).toBe(2);

    const out = await hooks.tool!.hive_worktree_batch.execute(
      { tasks: folders, feature: "parallel-feature" },
      tc,
    );
    const parsed = JSON.parse(out as string);

    expect(parsed.mode).toBe("delegate-batch");
    expect(parsed.openDelegations.length).toBe(2);
    expect(parsed.executionMode).toBeUndefined();
  });

  it("sequential returns one delegation at a time and supports resume", async () => {
    writeConfig(testRoot, { executionMode: "sequential" });
    const hooks = await plugin(makeCtx(testRoot));
    const tc = createToolContext("sess_seq");
    const folders = await setupFeature(hooks, tc, "seq-feature");
    expect(folders.length).toBe(2);

    const first = JSON.parse(
      (await hooks.tool!.hive_worktree_batch.execute(
        { tasks: folders, feature: "seq-feature" },
        tc,
      )) as string,
    );
    expect(first.mode).toBe("delegate-sequential");
    expect(first.executionMode).toBe("sequential");
    expect(first.openDelegations.length).toBe(1);
    expect(first.morePending).toBe(1);
    expect(first.delegationRequired).toBe(true);
    expect(first.delegationHint).toContain("SEQUENTIAL MODE");

    const second = JSON.parse(
      (await hooks.tool!.hive_worktree_batch.execute(
        { feature: "seq-feature", resume: true },
        tc,
      )) as string,
    );
    expect(second.mode).toBe("delegate-sequential");
    expect(second.openDelegations.length).toBe(1);
    expect(second.morePending).toBe(0);

    const done = JSON.parse(
      (await hooks.tool!.hive_worktree_batch.execute(
        { feature: "seq-feature", resume: true },
        tc,
      )) as string,
    );
    expect(done.terminal).toBe(true);
    expect(done.openDelegations).toBeUndefined();
  });

  it("sequential stops immediately when a worker fails to start", async () => {
    writeConfig(testRoot, { executionMode: "sequential" });
    const hooks = await plugin(makeCtx(testRoot));
    const tc = createToolContext("sess_seq_fail");
    await hooks.tool!.hive_feature_create.execute({ name: "seq-fail-feature" }, tc);

    const out = JSON.parse(
      (await hooks.tool!.hive_worktree_batch.execute(
        { tasks: ["99-nonexistent-task"], feature: "seq-fail-feature" },
        tc,
      )) as string,
    );
    expect(out.success).toBe(false);
    expect(out.terminal).toBe(true);
    expect(out.openDelegations).toBeUndefined();
    expect(out.error).toBeDefined();
  });

  it("sequential with empty tasks returns a clean terminal response", async () => {
    writeConfig(testRoot, { executionMode: "sequential" });
    const hooks = await plugin(makeCtx(testRoot));
    const tc = createToolContext("sess_seq_empty");
    await hooks.tool!.hive_feature_create.execute({ name: "seq-empty-feature" }, tc);

    const out = JSON.parse(
      (await hooks.tool!.hive_worktree_batch.execute(
        { tasks: [], feature: "seq-empty-feature" },
        tc,
      )) as string,
    );
    expect(out.terminal).toBe(true);
    expect(out.openDelegations).toBeUndefined();
  });

  it("resume without an active sequential batch returns terminal complete", async () => {
    writeConfig(testRoot, { executionMode: "sequential" });
    const hooks = await plugin(makeCtx(testRoot));
    const tc = createToolContext("sess_seq_resume");
    await hooks.tool!.hive_feature_create.execute({ name: "seq-resume-feature" }, tc);

    const out = JSON.parse(
      (await hooks.tool!.hive_worktree_batch.execute(
        { feature: "seq-resume-feature", resume: true },
        tc,
      )) as string,
    );
    expect(out.terminal).toBe(true);
    expect(out.openDelegations).toBeUndefined();
  });
});
