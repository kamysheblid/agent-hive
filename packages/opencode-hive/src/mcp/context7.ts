import type { RemoteMcpConfig } from './types';

/**
 * Context7 MCP for official documentation lookup
 * 
 * Supports configuration via environment variables:
 * - CONTEXT7_API_KEY: Optional API key for higher rate limits
 * 
 * Uses remote MCP by default (no local installation needed)
 */

// Check for user-provided API key
const context7ApiKey = process.env.CONTEXT7_API_KEY || process.env.OPENCODE_CONTEXT7_API_KEY;

export const context7Mcp: RemoteMcpConfig = {
  type: 'remote',
  // Prefer remote MCP endpoint (no local installation needed)
  url: 'https://mcp.context7.com/mcp',
  headers: context7ApiKey
    ? { 'Authorization': `Bearer ${context7ApiKey}` }
    : undefined,
  // No OAuth required - works with or without API key
  oauth: false,
};
