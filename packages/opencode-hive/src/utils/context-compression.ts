/**
 * Context Compression Utility
 * 
 * Provides automatic context compression for Hive when context reaches threshold.
 * Similar to DCP (Dynamic Context Pruning) or oh-my-openagent's context management.
 * 
 * Features:
 * - Automatic compression at 50% context threshold
 * - Trimming unnecessary tool outputs
 * - Deduplication, write superseding, and error purging strategies
 * - Zero-cost automatic pruning strategies
 */

// Define Message type locally to avoid import issues
interface MessageContent {
  type: "text";
  text?: string;
}

interface ToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant" | "tool" | "system";
  content?: string | MessageContent[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface CompressionConfig {
  /** Context threshold to trigger compression (0-1, default: 0.5 = 50%) */
  threshold?: number;
  /** Enable automatic compression */
  enabled?: boolean;
  /** Protected tool output patterns (glob) */
  protectedTools?: string[];
  /** Protect user messages from compression */
  protectUserMessages?: boolean;
  /** Maximum tool calls to keep after compression */
  maxToolCalls?: number;
}

const DEFAULT_CONFIG: Required<CompressionConfig> = {
  threshold: 0.5,
  enabled: true,
  protectedTools: [
    "hive_feature_create",
    "hive_plan_write", 
    "hive_worktree_commit",
    "hive_merge",
  ],
  protectUserMessages: true,
  maxToolCalls: 50,
};

/**
 * Estimate token count from messages (rough approximation)
 * ~4 characters per token on average
 */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += msg.content.length / 4;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === "string") {
          total += (part as string).length / 4;
        } else if (part && typeof part === "object") {
          const p = part as { type?: string; text?: string; content?: string };
          if (p.type === "text") {
            total += (p.text?.length ?? 0) / 4;
          } else if (p.type === "tool_result") {
            // Tool results can be large, count more conservatively
            total += (p.content?.length ?? 0) / 6;
          }
        }
      }
    }
  }
  return Math.ceil(total);
}

/**
 * Calculate context usage ratio (0-1)
 */
export function getContextUsage(messages: Message[], contextLimit: number): number {
  const tokens = estimateTokens(messages);
  return tokens / contextLimit;
}

/**
 * Check if context compression is needed
 */
export function needsCompression(
  messages: Message[], 
  contextLimit: number,
  config: CompressionConfig = DEFAULT_CONFIG
): boolean {
  if (!config.enabled) return false;
  return getContextUsage(messages, contextLimit) >= config.threshold;
}

/**
 * Check if a tool is protected from compression
 */
function isToolProtected(toolName: string, config: Required<CompressionConfig>): boolean {
  for (const pattern of config.protectedTools) {
    if (toolName === pattern) return true;
    // Simple glob matching
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      if (regex.test(toolName)) return true;
    }
  }
  return false;
}

/**
 * Strategy 1: Remove duplicate tool calls
 * Keep only the most recent occurrence of each tool call
 */
function deduplicateToolCalls(messages: Message[]): Message[] {
  const seen = new Map<string, number>();
  const result: Message[] = [];
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      result.unshift(msg);
      continue;
    }
    
    for (const toolCall of msg.tool_calls) {
      const key = `${toolCall.name}:${JSON.stringify(toolCall.arguments || {}).slice(0, 100)}`;
      if (!seen.has(key)) {
        seen.set(key, i);
      }
    }
  }
  
  // Rebuild preserving order
  const keptIndices = new Set(seen.values());
  return messages.filter((_, idx) => keptIndices.has(idx));
}

/**
 * Strategy 2: Write superseding
 * When a file is written multiple times, keep only the latest write
 */
function removeSupersededWrites(messages: Message[]): Message[] {
  const latestWrite = new Map<string, number>();
  const result: Message[] = [];
  
  // First pass: find latest write for each file
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls?.length) continue;
    
    for (const toolCall of msg.tool_calls) {
      if (toolCall.name === "filesystem_write_file" || toolCall.name === "write") {
        const args = toolCall.arguments as { path?: string } | undefined;
        if (args?.path) {
          latestWrite.set(args.path, i);
        }
      }
    }
  }
  
  // Second pass: keep writes and intermediate tool results
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Keep all non-tool messages
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      result.push(msg);
      continue;
    }
    
    // For tool calls, keep only if it's the latest for each file
    const filteredCalls = msg.tool_calls.filter(tc => {
      if (tc.name === "filesystem_write_file" || tc.name === "write") {
        const args = tc.arguments as { path?: string } | undefined;
        if (args?.path) {
          return latestWrite.get(args.path) === i;
        }
      }
      return true;
    });
    
    if (filteredCalls.length > 0) {
      result.push({ ...msg, tool_calls: filteredCalls });
    }
  }
  
  return result;
}

/**
 * Strategy 3: Error purging
 * Remove tool results that are errors or not relevant
 */
function purgeErrors(messages: Message[]): Message[] {
  return messages.filter(msg => {
    if (msg.role !== "tool") return true;
    
    const content = typeof msg.content === "string" ? msg.content : "";
    
    // Remove error messages
    if (content.includes("Error:") || content.includes("error:") ||
        content.includes("Failed:") || content.includes("failed:")) {
      // But keep the last few errors - they might be important
      return false;
    }
    
    // Remove empty results
    if (!content.trim() || content === "undefined" || content === "null") {
      return false;
    }
    
    return true;
  });
}

/**
 * Strategy 4: Truncate long tool outputs
 * Keep only the beginning and end of very long outputs
 */
function truncateLongOutputs(messages: Message[], maxLength: number = 2000): Message[] {
  return messages.map(msg => {
    if (msg.role !== "tool") return msg;
    
    const content = typeof msg.content === "string" ? msg.content : "";
    
    if (content.length > maxLength) {
      const kept = content.slice(0, maxLength / 2) + 
        "\n\n[... " + (content.length - maxLength) + " bytes truncated ...]\n\n" +
        content.slice(-maxLength / 2);
      return { ...msg, content: kept };
    }
    
    return msg;
  });
}

/**
 * Strategy 5: Keep only recent tool calls
 * Remove old tool calls beyond maxToolCalls
 */
function trimOldToolCalls(messages: Message[], maxToolCalls: number): Message[] {
  let toolCallCount = 0;
  
  return messages.filter(msg => {
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      return true;
    }
    
    const msgToolCount = msg.tool_calls.length;
    
    if (toolCallCount + msgToolCount <= maxToolCalls) {
      toolCallCount += msgToolCount;
      return true;
    }
    
    // Partial keep if we're over the limit
    const remaining = maxToolCalls - toolCallCount;
    if (remaining > 0) {
      toolCallCount = maxToolCalls;
      return { 
        ...msg, 
        tool_calls: msg.tool_calls.slice(-remaining) 
      };
    }
    
    return false;
  });
}

/**
 * Main compression function
 * Applies all strategies to reduce context size
 */
export function compressContext(
  messages: Message[],
  config: CompressionConfig = DEFAULT_CONFIG,
  contextLimit: number = 200000
): { compressed: Message[]; stats: CompressionStats } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const startTokens = estimateTokens(messages);
  let compressed = [...messages];
  
  // Apply strategies in order
  compressed = purgeErrors(compressed);
  compressed = deduplicateToolCalls(compressed);
  compressed = removeSupersededWrites(compressed);
  compressed = truncateLongOutputs(compressed, 3000);
  compressed = trimOldToolCalls(compressed, cfg.maxToolCalls);
  
  const endTokens = estimateTokens(compressed);
  
  return {
    compressed,
    stats: {
      originalTokens: startTokens,
      compressedTokens: endTokens,
      reductionRatio: startTokens > 0 ? (startTokens - endTokens) / startTokens : 0,
      originalMessages: messages.length,
      compressedMessages: compressed.length,
    },
  };
}

export interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  reductionRatio: number;
  originalMessages: number;
  compressedMessages: number;
}

/**
 * Build a compression hint prompt
 * This is injected into context to guide the LLM
 */
export function buildCompressionHint(): string {
  return `
## Context Compression Active

The conversation has been compressed to fit within the context window.
- Previous tool calls may have been deduplicated or truncated
- Only the most recent and relevant information is retained
- Focus on continuing from the current state rather than redoing completed work

If you need context from earlier in the conversation, you can:
- Ask the user to provide relevant context
- Use hive_context_write to check for saved context
- Use hive_plan_read to review the current plan
`;
}

/**
 * Create a session compaction hook for Hive
 * This can be used with experimental.session.compacting hook
 */
export function createCompactionHook(config: CompressionConfig = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  return function compactionHook(
    input: { sessionID: string; messages?: Message[]; contextLimit?: number },
    output: { context: string[]; prompt?: string }
  ) {
    const messages = input.messages || [];
    const contextLimit = input.contextLimit || 200000;
    
    // Check if compression is needed
    if (!needsCompression(messages, contextLimit, cfg)) {
      return;
    }
    
    // Compress the context
    const { compressed, stats } = compressContext(messages, cfg, contextLimit);
    
    // Add compression hint to context
    output.context.push(buildCompressionHint());
    
    console.log(`[hive:compaction] Compressed context: ${stats.originalTokens} → ${stats.compressedTokens} tokens (${Math.round(stats.reductionRatio * 100)}% reduction)`);
  };
}
