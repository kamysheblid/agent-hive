import type { LocalMcpConfig } from './types';

/**
 * @paretools/search MCP for structured code search
 * 
 * Wraps ripgrep and fd with typed JSON output.
 * Part of the Pare suite of MCP servers.
 * 
 * Features:
 * - 65-95% token reduction vs raw CLI output
 * - Structured, schema-validated JSON
 * - search, find, count tools
 */

export const pareSearchMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@paretools/search'],
};
