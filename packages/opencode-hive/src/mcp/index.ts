import type { McpConfig } from './types';
import { websearchMcp } from './websearch';
import { context7Mcp } from './context7';
import { grepAppMcp } from './grep-app';
import { pareSearchMcp } from './pare-search';
import { searxngMcp } from './searxng';

/**
 * Built-in MCP configurations
 * 
 * Priority: Remote MCPs are preferred (no local installation needed)
 * - websearch: Remote (Exa AI) - supports EXA_API_KEY env var
 * - context7: Remote (Context7) - supports CONTEXT7_API_KEY env var
 * - grep_app: Remote (GitHub code search)
 * - pare_search: Local npx (structured ripgrep/fd output)
 * - searxng: Local npx (privacy meta-search)
 * 
 * Note: ast_grep MCP removed - use @ast-grep/napi directly
 * Note: veil removed - requires manual init, redundant with grep-mcp
 */

const allBuiltinMcps: Record<string, McpConfig> = {
  // Remote MCPs (preferred - no installation needed)
  websearch: websearchMcp,
  context7: context7Mcp,
  grep_app: grepAppMcp,
  // @paretools/search (structured ripgrep/fd)
  pare_search: pareSearchMcp,
  // SearXNG meta-search (privacy)
  searxng: searxngMcp,
};

// Lazy initialization - MCPs are only resolved when first accessed
let cachedMcps: Record<string, McpConfig> | null = null;

export const getBuiltinMcps = (disabledMcps: string[] = []): Record<string, McpConfig> => {
  if (!cachedMcps) {
    cachedMcps = allBuiltinMcps;
  }
  const disabled = new Set(disabledMcps);
  return Object.fromEntries(
    Object.entries(cachedMcps).filter(([name]) => !disabled.has(name)),
  );
};

// Backward compatibility alias
export const createBuiltinMcps = getBuiltinMcps;
