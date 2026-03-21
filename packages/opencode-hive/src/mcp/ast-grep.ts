import type { LocalMcpConfig } from './types';

/**
 * Ast-grep MCP for code analysis
 * 
 * Uses @notprolands/ast-grep-mcp via npx for AST-based code search.
 */

export const astGrepMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@notprolands/ast-grep-mcp'],
};
