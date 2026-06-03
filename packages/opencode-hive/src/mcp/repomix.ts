import type { LocalMcpConfig } from './types';

/**
 * Repomix MCP using the built-in MCP mode
 *
 * Runs `repomix --mcp` locally via npx, which exposes tools:
 * - pack_codebase: Pack a local directory for AI analysis
 * - pack_remote_repository: Clone and pack a remote GitHub repo
 * - grep_repomix_output: Search patterns in packed output
 *
 * Replaces the old tool-based `execSync` approach with a proper
 * non-blocking MCP server (separate process, async communication).
 */

export const repomixMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '--yes', 'repomix', '--mcp'],
  environment: undefined,
};
