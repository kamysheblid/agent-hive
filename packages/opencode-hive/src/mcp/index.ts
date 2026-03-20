import type { McpConfig } from './types';
import { websearchMcp } from './websearch';
import { context7Mcp } from './context7';
import { grepAppMcp } from './grep-app';
import { astGrepMcp } from './ast-grep';
import { pareSearchMcp } from './pare-search';

/**
 * Built-in MCP configurations
 * 
 * Priority: Remote MCPs are preferred (no local installation needed)
 * - websearch: Remote (Exa AI) - supports EXA_API_KEY env var
 * - context7: Remote (Context7) - supports CONTEXT7_API_KEY env var
 * - grep_app: Remote (GitHub code search)
 * - ast_grep: Native NAPI (faster than MCP-based)
 * - pare_search: Local npx (structured ripgrep/fd output)
 */

const allBuiltinMcps: Record<string, McpConfig> = {
  // Remote MCPs (preferred - no installation needed)
  websearch: websearchMcp,
  context7: context7Mcp,
  grep_app: grepAppMcp,
  // Native ast-grep (replaces MCP-based ast-grep)
  ast_grep: astGrepMcp,
  // @paretools/search (structured ripgrep/fd)
  pare_search: pareSearchMcp,
};

export const createBuiltinMcps = (disabledMcps: string[] = []): Record<string, McpConfig> => {
  const disabled = new Set(disabledMcps);
  return Object.fromEntries(
    Object.entries(allBuiltinMcps).filter(([name]) => !disabled.has(name)),
  );
};

// Export local fallback for ast-grep (can be used if remote fails)
export { astGrepMcp as astGrepLocalMcp };
