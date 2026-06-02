/**
 * Compaction Restoration — Re-inject memories after session compact.
 *
 * Pattern sourced from opencode-mem (tickernelz/opencode-mem).
 * After a session compaction event, relevant vector memories are
 * re-injected into the session via session.prompt with synthetic:true
 * parts so future messages benefit from persisted knowledge.
 *
 * 0-risk principle (from MrGray17/opentoken):
 * - Every step is wrapped in try-catch with silent fallback
 * - Fire-and-forget: never blocks the compaction flow
 * - If any step fails, skip silently with a console.warn log
 */

import { searchMemories } from '../services/vector-memory.js';

export interface CompactionRestorationConfig {
  enabled?: boolean;
  maxMemories?: number;
}

const DEFAULT_MAX_MEMORIES = 5;

/**
 * Re-inject relevant vector memories into a session after compaction.
 *
 * This is a best-effort, fire-and-forget operation. It:
 * 1. Searches for recent vector memories
 * 2. Format them as a compact context block
 * 3. Injects them into the session via client.session.prompt()
 * 4. Shows a toast notification on success
 *
 * @param sessionID - The session ID being compacted
 * @param client - OpenCode client instance (for session.prompt + tui)
 * @param config - Compaction restoration configuration
 */
export async function reInjectMemoriesAfterCompact(
  sessionID: string,
  client: any,
  config?: CompactionRestorationConfig,
): Promise<void> {
  // 0-risk guard: if disabled, skip immediately
  if (config?.enabled === false) {
    return;
  }

  try {
    const maxMemories = config?.maxMemories ?? DEFAULT_MAX_MEMORIES;

    // Step 1: Fetch recent vector memories
    // Uses searchMemories with empty query to get most recent entries
    const { results: memories } = await searchMemories({
      limit: maxMemories,
    });

    if (!memories || memories.length === 0) {
      return; // No memories to restore — skip silently
    }

    // Step 2: Format memories as a compact context block
    const memoryLines = memories.map((m: any) => {
      const type = m.type ? `[${m.type}]` : '';
      const scope = m.scope ? `(${m.scope})` : '';
      const content = typeof m.content === 'string'
        ? m.content.slice(0, 300)
        : JSON.stringify(m.content).slice(0, 300);
      return `  ${type}${scope} ${content}`;
    });

    const memoryContext = [
      '<persistent_memory>',
      'The following memories were preserved from before compaction.',
      'Use this context to maintain continuity with previous work.',
      '',
      ...memoryLines,
      '</persistent_memory>',
    ].join('\n');

    // Step 3: Try to inject via session.prompt (OpenCode-specific API)
    // This is a fire-and-forget call — never await on the user-facing path
    if (client?.session?.prompt) {
      try {
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [
              {
                type: 'text' as const,
                text: memoryContext,
                synthetic: true as const,
              },
            ],
            noReply: true as const,
          },
        });
      } catch (promptError) {
        // 0-risk: session.prompt might not be available or might fail
        console.warn(
          '[compaction-restoration] Failed to inject memories via session.prompt:',
          promptError instanceof Error ? promptError.message : promptError,
        );
      }
    }

    // Step 4: Show toast notification (best-effort)
    if (client?.tui?.showToast) {
      try {
        await client.tui.showToast({
          body: {
            title: 'Memories Restored',
            message: `${memories.length} memories re-injected after compaction`,
            variant: 'info' as const,
            duration: 3000,
          },
        });
      } catch {
        // Toast is purely cosmetic — ignore failures
      }
    }
  } catch (error) {
    // 0-risk: never throw, always log and swallow
    console.warn(
      '[compaction-restoration] Failed to restore memories:',
      error instanceof Error ? error.message : error,
    );
  }
}
