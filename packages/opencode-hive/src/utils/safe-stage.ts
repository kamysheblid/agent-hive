/**
 * Safe Stage — 0-risk wrapper utilities.
 *
 * Pattern from MrGray17/opentoken (MIT).
 * Every operation MUST have a conservative safety guard:
 * - If a step fails, return a meaningful fallback
 * - Every try-catch logs and never throws
 * - Conservative filter: if result is "bigger" than fallback, use fallback
 */

/**
 * Synchronous safe wrapper with conservative filtering.
 * @param name - Operation name for logging
 * @param fn - Operation to execute
 * @param fallback - Default value on failure
 * @returns Operation result or fallback
 */
export function safeStage<T>(name: string, fn: () => T, fallback: T): T {
  try {
    const result = fn();
    // Conservative filter: if result is unexpectedly large, use fallback
    if (typeof result === 'string' && typeof fallback === 'string') {
      if (result.length > fallback.length * 3 && fallback.length > 0) {
        console.warn(`[hive] safeStage:${name} output too large (${result.length} vs ${fallback.length}), using fallback`);
        return fallback;
      }
    }
    return result;
  } catch (err) {
    console.error(`[hive] safeStage:${name} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Async safe wrapper with conservative filtering.
 * @param name - Operation name for logging
 * @param fn - Async operation to execute
 * @param fallback - Default value on failure
 * @returns Operation result or fallback
 */
export async function safeStageAsync<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const result = await fn();
    // Conservative filter: if result is unexpectedly large, use fallback
    if (typeof result === 'string' && typeof fallback === 'string') {
      if (result.length > fallback.length * 3 && fallback.length > 0) {
        console.warn(`[hive] safeStageAsync:${name} output too large (${result.length} vs ${fallback.length}), using fallback`);
        return fallback;
      }
    }
    return result;
  } catch (err) {
    console.error(`[hive] safeStageAsync:${name} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Hook-safe async wrapper: wraps an async hook handler so it never throws.
 * @param name - Hook name for logging
 * @param handler - The hook handler function
 * @returns A wrapped handler that never throws
 */
export function safeHook<TInput, TOutput>(
  name: string,
  handler: (input: TInput, output: TOutput) => Promise<void>,
): (input: TInput, output: TOutput) => Promise<void> {
  return async (input: TInput, output: TOutput): Promise<void> => {
    try {
      await handler(input, output);
    } catch (err) {
      console.error(`[hive] safeHook:${name} uncaught:`, err instanceof Error ? err.message : err);
      // Never throw from a hook — plugin must survive
    }
  };
}

/**
 * Conservative filter: ensures output doesn't exceed size limits.
 * If the content is more than `maxFactor` times the original, return original.
 */
export function conservativeFilter(
  original: string,
  result: string,
  maxFactor = 3,
): string {
  if (result.length > original.length * maxFactor && original.length > 0) {
    return original;
  }
  return result;
}
