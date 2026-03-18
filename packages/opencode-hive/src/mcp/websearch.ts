import type { RemoteMcpConfig, LocalMcpConfig } from './types';

/**
 * WebSearch MCP using Exa AI
 * 
 * Supports configuration via environment variables:
 * - EXA_API_KEY: Optional API key for higher rate limits
 * 
 * Without API key: Uses public endpoint with limited rate
 * With API key: Uses authenticated endpoint with higher limits
 */

// Check for user-provided API key, fallback to public endpoint if not available
const exaApiKey = process.env.EXA_API_KEY || process.env.OPENCODE_EXA_API_KEY;

export const websearchMcp: RemoteMcpConfig = {
  type: 'remote',
  // Prefer remote MCP endpoint (no local installation needed)
  url: 'https://mcp.exa.ai/mcp?tools=web_search_exa',
  headers: exaApiKey
    ? { 'x-api-key': exaApiKey }
    : undefined,
  // No OAuth required - works with or without API key
  oauth: false,
};

// Also export a local fallback using npx (for when remote fails)
export const websearchLocalMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', 'exa-ai-mcp'],
  environment: exaApiKey ? { EXA_API_KEY: exaApiKey } : undefined,
};
