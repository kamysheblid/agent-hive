import type { LocalMcpConfig } from './types';

/**
 * mcp-searxng MCP for SearXNG meta-search
 * 
 * Privacy-respecting meta-search engine aggregator
 * - Can use public SearXNG instances or self-hosted
 * - Good for privacy-conscious searches
 * 
 * https://github.com/ihor-sokoliuk/mcp-searxng
 */

export const searxngMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', 'mcp-searxng'],
};
