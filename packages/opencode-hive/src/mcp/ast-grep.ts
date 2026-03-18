import type { RemoteMcpConfig, LocalMcpConfig } from './types';

/**
 * Ast-grep MCP for code analysis
 * 
 * Prefers remote MCP when available, falls back to local npx
 * Remote is preferred to avoid local installation
 */

export const astGrepRemoteMcp: RemoteMcpConfig = {
  type: 'remote',
  // Try to use remote ast-grep MCP if available
  url: 'https://mcp.ast-grep.dev/mcp',
  oauth: false,
};

export const astGrepMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@notprolands/ast-grep-mcp'],
};
