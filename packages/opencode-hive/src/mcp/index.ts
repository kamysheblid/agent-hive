import type { McpConfig } from './types';
import { websearchMcp } from './websearch';
import { context7Mcp } from './context7';
import { grepAppMcp } from './grep-app';
import { repomixMcp } from './repomix';
import { ddgMcp } from './ddg';

/**
 * Built-in MCP configurations
 * 
 * Priority: Remote MCPs are preferred (no local installation needed)
 * - websearch: Remote (Exa AI) - supports EXA_API_KEY env var
 * - context7: Remote (Context7) - supports CONTEXT7_API_KEY env var
 * - grep_app: Remote (GitHub code search)
 * - repomix: Local (npx) - packs repos for AI analysis via repomix --mcp
 * - crw (conditional): Local (npx) - web scraping & crawling, activated when CRW_API_URL + CRW_API_KEY set
 */

const allBuiltinMcps: Record<string, McpConfig> = {
  // Remote MCPs (preferred - no installation needed)
  websearch: websearchMcp,
  context7: context7Mcp,
  grep_app: grepAppMcp,
  // Local MCPs
  repomix: repomixMcp,
  ddg: ddgMcp,
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
