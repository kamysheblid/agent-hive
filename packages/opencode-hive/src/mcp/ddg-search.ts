import type { LocalMcpConfig } from './types';

/**
 * @oevortex/ddg_search MCP for DuckDuckGo web search
 * 
 * Free web search using DuckDuckGo, IAsk AI, and Monica AI
 * - No API key required
 * - Good for general web searches
 * 
 * https://github.com/oevortex/ddg_search
 */

export const ddgSearchMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@oevortex/ddg_search@1.2.2', 'mcp', 'server'],
};
