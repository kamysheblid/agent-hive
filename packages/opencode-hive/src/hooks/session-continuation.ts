/**
 * Session Continuation — Nonstop When Tasks Remain
 *
 * Inspired by oh-my-openagent's start-work-continuation (nonstop).
 * Checks for pending/in-progress tasks on compaction and injects a
 * continuation directive so the agent auto-continues instead of stopping.
 *
 * 0-risk: all operations are wrapped, failures return empty/null.
 */

import { detectContext, TaskService } from 'hive-core';

export interface ContinuationState {
  /** Whether we've injected continuation in this compaction cycle */
  injected: boolean;
  /** Mark as injected */
  markInjected: () => void;
  /** Reset for next cycle */
  reset: () => void;
}

export function createContinuationState(): ContinuationState {
  let injected = false;
  return {
    get injected() {
      return injected;
    },
    markInjected() {
      injected = true;
    },
    reset() {
      injected = false;
    },
  };
}

export interface PendingTaskInfo {
  folder: string;
  name: string;
  status: string;
  summary?: string;
}

/**
 * Get pending/in_progress tasks for the active feature.
 * Uses the hive-core services directly.
 */
export function getPendingTaskCount(
  directory: string,
): { feature: string | null; pending: PendingTaskInfo[]; nextTask: PendingTaskInfo | null } {
  try {
    const context = detectContext(directory);
    const featureName = context.feature ?? null;
    if (!featureName) return { feature: null, pending: [], nextTask: null };

    const taskService = new TaskService(directory);
    const tasks = taskService.list(featureName);
    const pending = tasks
      .filter(t => t.status === 'pending' || t.status === 'in_progress')
      .map(t => ({
        folder: t.folder ?? t.name ?? '',
        name: t.name ?? t.folder ?? '',
        status: t.status ?? 'unknown',
        summary: t.summary,
      }));
    const nextTask = pending.length > 0 ? pending[0] : null;

    return { feature: featureName, pending, nextTask };
  } catch {
    return { feature: null, pending: [], nextTask: null };
  }
}

/**
 * Build a continuation context block for injection into compaction.
 */
export function buildContinuationContext(
  feature: string,
  pending: PendingTaskInfo[],
  nextTask: PendingTaskInfo | null,
): string | null {
  if (pending.length === 0) return null;

  return `
## ⏩ Session Continuation — Pending Tasks Detected

You have unfinished work in feature "${feature}".

### Remaining Tasks (${pending.length})
${pending
  .map(
    t =>
      `- [${t.status === 'in_progress' ? '~' : ' '}] **${t.name}** (${t.status})${t.summary ? ': ' + t.summary : ''}`,
  )
  .join('\n')}

${nextTask ? `\n### Next Task\nContinue with: **${nextTask.name}** (${nextTask.folder})` : ''}

### Instructions
- Continue working. Do NOT ask the user "should I continue?"
- Use hive_status() to check current state before proceeding
- The session will re-evaluate after the next turn
`;
}
