import type { LocalMcpConfig } from './types';

/**
 * Ast-grep MCP for code analysis
 * 
 * Uses local npx execution (remote endpoint mcp.ast-grep.dev is unavailable)
 */

export const astGrepMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@notprolands/ast-grep-mcp'],
};
