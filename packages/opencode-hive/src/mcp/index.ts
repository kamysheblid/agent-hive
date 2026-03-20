import type { McpConfig } from './types';
import { websearchMcp } from './websearch';
import { context7Mcp } from './context7';
import { grepAppMcp } from './grep-app';
import { pareSearchMcp } from './pare-search';
import { veilMcp } from './veil';

/**
 * Built-in MCP configurations
 * 
 * Priority: Remote MCPs are preferred (no local installation needed)
 * - websearch: Remote (Exa AI) - supports EXA_API_KEY env var
 * - context7: Remote (Context7) - supports CONTEXT7_API_KEY env var
 * - grep_app: Remote (GitHub code search)
 * - pare_search: Local npx (structured ripgrep/fd output)
 * - veil: Local npx (code discovery and retrieval)
 * 
 * Note: ast_grep MCP removed - use native ast-grep tools instead
 */

const allBuiltinMcps: Record<string, McpConfig> = {
  // Remote MCPs (preferred - no installation needed)
  websearch: websearchMcp,
  context7: context7Mcp,
  grep_app: grepAppMcp,
  // @paretools/search (structured ripgrep/fd)
  pare_search: pareSearchMcp,
  // @ushiradineth/veil (code discovery)
  veil: veilMcp,
};

export const createBuiltinMcps = (disabledMcps: string[] = []): Record<string, McpConfig> => {
  const disabled = new Set(disabledMcps);
  return Object.fromEntries(
    Object.entries(allBuiltinMcps).filter(([name]) => !disabled.has(name)),
  );
};
