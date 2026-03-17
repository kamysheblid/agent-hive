/**
 * Auto-Compact Hook
 *
 * Automatically compacts session context when usage exceeds threshold.
 * Similar to micode's auto-compact but adapted for Hive.
 */

import type { PluginInput } from "@opencode-ai/plugin";

interface AutoCompactConfig {
  /** Compaction threshold (0-1), defaults to 0.5 */
  threshold?: number;
  /** Cooldown between compactions in ms, defaults to 60000 */
  cooldownMs?: number;
  /** Timeout for compaction in ms, defaults to 120000 */
  timeoutMs?: number;
}

interface AutoCompactState {
  inProgress: Set<string>;
  lastCompactTime: Map<string, number>;
  pendingCompactions: Map<string, { resolve: () => void; reject: (error: Error) => void; timeoutId: ReturnType<typeof setTimeout> }>;
}

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_COOLDOWN_MS = 60000;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_ERROR_LENGTH = 100;

export function createAutoCompactHook(ctx: PluginInput, config?: AutoCompactConfig) {
  const threshold = config?.threshold ?? DEFAULT_THRESHOLD;
  const cooldownMs = config?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const state: AutoCompactState = {
    inProgress: new Set(),
    lastCompactTime: new Map(),
    pendingCompactions: new Map(),
  };

  return {
    event: async (input: { event: { type: string; properties?: unknown } }) => {
      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.deleted") {
        handleSessionDeleted(state, props);
        return;
      }

      if (event.type === "message.updated") {
        await handleMessageUpdated(ctx, state, threshold, cooldownMs, timeoutMs, props);
      }
    },
  };
}

function handleSessionDeleted(state: AutoCompactState, props: Record<string, unknown> | undefined): void {
  const sessionInfo = props?.info as { id?: string } | undefined;
  if (!sessionInfo?.id) return;

  state.inProgress.delete(sessionInfo.id);
  state.lastCompactTime.delete(sessionInfo.id);

  const pending = state.pendingCompactions.get(sessionInfo.id);
  if (pending) {
    clearTimeout(pending.timeoutId);
    state.pendingCompactions.delete(sessionInfo.id);
    pending.reject(new Error("Session deleted"));
  }
}

async function handleMessageUpdated(
  ctx: PluginInput,
  state: AutoCompactState,
  threshold: number,
  cooldownMs: number,
  timeoutMs: number,
  props: Record<string, unknown> | undefined,
): Promise<void> {
  const info = props?.info as Record<string, unknown> | undefined;
  const sessionID = info?.sessionID as string | undefined;

  if (!sessionID || info?.role !== "assistant") return;

  if (info?.summary === true) {
    const pending = state.pendingCompactions.get(sessionID);
    if (pending) {
      clearTimeout(pending.timeoutId);
      state.pendingCompactions.delete(sessionID);
      pending.resolve();
    }
    return;
  }

  if (state.pendingCompactions.has(sessionID)) return;

  const usageRatio = computeUsageRatio(info);
  if (usageRatio === null) return;

  if (usageRatio >= threshold) {
    const modelID = (info?.modelID as string) || "";
    const providerID = (info?.providerID as string) || "";
    void triggerCompaction(ctx, state, threshold, sessionID, providerID, modelID, usageRatio, cooldownMs, timeoutMs);
  }
}

function computeUsageRatio(info: Record<string, unknown>): number | null {
  const tokens = info?.tokens as { input?: number; cache?: { read?: number } } | undefined;
  const inputTokens = tokens?.input || 0;
  const cacheRead = tokens?.cache?.read || 0;
  const totalUsed = inputTokens + cacheRead;

  if (totalUsed === 0) return null;

  const modelID = (info?.modelID as string) || "";
  const contextLimit = getContextLimit(modelID);
  
  if (!contextLimit) return null;
  
  return totalUsed / contextLimit;
}

function getContextLimit(modelID: string): number {
  // Common context limits
  const limits: Record<string, number> = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    "gpt-4": 8192,
    "gpt-3.5-turbo": 16385,
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-5-sonnet": 200000,
    "claude-3-haiku": 200000,
    "big-pickle": 200000,
  };

  for (const [key, limit] of Object.entries(limits)) {
    if (modelID.includes(key)) {
      return limit;
    }
  }

  return 100000; // Default fallback
}

function waitForCompaction(state: AutoCompactState, sessionID: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      state.pendingCompactions.delete(sessionID);
      reject(new Error("Compaction timed out"));
    }, timeoutMs);

    state.pendingCompactions.set(sessionID, { resolve, reject, timeoutId });
  });
}

async function triggerCompaction(
  ctx: PluginInput,
  state: AutoCompactState,
  threshold: number,
  sessionID: string,
  providerID: string,
  modelID: string,
  usageRatio: number,
  cooldownMs: number,
  timeoutMs: number,
): Promise<void> {
  if (state.inProgress.has(sessionID)) return;

  const lastCompact = state.lastCompactTime.get(sessionID) || 0;
  if (Date.now() - lastCompact < cooldownMs) return;

  state.inProgress.add(sessionID);

  try {
    const usedPercent = Math.round(usageRatio * 100);
    const thresholdPercent = Math.round(threshold * 100);

    await ctx.client.tui.showToast({
      body: {
        title: "Auto Compacting",
        message: `Context at ${usedPercent}% (threshold: ${thresholdPercent}%). Summarizing...`,
        variant: "warning",
        duration: 5000,
      },
    }).catch(() => {});

    const compactionPromise = waitForCompaction(state, sessionID, timeoutMs);

    await ctx.client.session.summarize({
      path: { id: sessionID },
      body: { providerID, modelID },
      query: { directory: ctx.directory },
    });

    await compactionPromise;
    state.lastCompactTime.set(sessionID, Date.now());

    await ctx.client.tui.showToast({
      body: {
        title: "Compaction Complete",
        message: "Session summarized. Continuing...",
        variant: "success",
        duration: 3000,
      },
    }).catch(() => {});

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts: [
          {
            type: "text",
            text: "Context was compacted. Continue from where you left off.",
          },
        ],
        model: { providerID, modelID },
      },
      query: { directory: ctx.directory },
    }).catch(() => {});

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await ctx.client.tui.showToast({
      body: {
        title: "Compaction Failed",
        message: errorMsg.slice(0, MAX_ERROR_LENGTH),
        variant: "error",
        duration: 5000,
      },
    }).catch(() => {});
  } finally {
    state.inProgress.delete(sessionID);
  }
}
