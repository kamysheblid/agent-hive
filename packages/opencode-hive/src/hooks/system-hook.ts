/**
 * Core hook cadence logic, extracted for testability.
 * Determines whether a hook should execute based on its configured cadence.
 */
const fallbackTurnCounters: Record<string, number> = {};

export function shouldExecuteHook(
  hookName: string,
  configService: { getHookCadence(name: string, opts?: { safetyCritical?: boolean }): number } | undefined,
  turnCounters: Record<string, number> | undefined,
  options?: { safetyCritical?: boolean },
): boolean {
  // Fall back to cadence=1 if config service is unavailable during early hook execution.
  const cadence = configService?.getHookCadence(hookName, options) ?? 1;
  const counters = turnCounters ?? fallbackTurnCounters;

  // Increment turn counter
  counters[hookName] = (counters[hookName] || 0) + 1;
  const currentTurn = counters[hookName];

  // Cadence of 1 means fire every turn (no gating needed)
  if (cadence === 1) {
    return true;
  }

  // Fire on turns 1, (1+cadence), (1+2*cadence), ...
  // Using (currentTurn - 1) % cadence === 0 ensures turn 1 always fires
  return (currentTurn - 1) % cadence === 0;
}

export const HIVE_SYSTEM_PROMPT = `
## Language Policy

1. **User responses** match the user's language throughout the conversation (e.g., if user writes Vietnamese, respond in Vietnamese; if English, respond in English)
2. **Internal operations** prefer English (tool calls, sub-agent prompts, task descriptions, commit messages, comments). Thinking/analysis may be in the user's language if it helps clarity — no rigid enforcement.
3. **Sub-agent delegation** prompts in English regardless of user language (required for cross-model compatibility)
4. **Consistency**: prefer to stay in the established language, but switching is fine if the user switches first or explicitly requests

## Hive — Active Session

**Important:** hive_worktree_commit commits to the task branch but does NOT merge.
Use hive_merge to integrate changes into the current branch.
`;
