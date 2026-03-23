import type { LocalMcpConfig } from './types';

/**
 * mcp-searxng MCP for SearXNG meta-search
 * 
 * Privacy-respecting meta-search engine aggregator
 * - REQUIRES: SEARXNG_URL environment variable
 * - Without it, MCP will error (-32000)
 * 
 * https://github.com/ihor-sokoliuk/mcp-searxng
 */

export const searxngMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', 'mcp-searxng'],
  environment: {
    SEARXNG_URL: process.env.SEARXNG_URL || '',
  },
};
