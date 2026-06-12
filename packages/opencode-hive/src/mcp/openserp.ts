import type { LocalMcpConfig } from './types';

/**
 * OpenSERP MCP using the built-in MCP mode
 *
 * Runs `@openserp/mcp` locally via npx, which exposes tools:
 * - openserp_search: Real search results from Google/Bing/Yandex/DuckDuckGo/Baidu/Ecosia
 * - openserp_mega_search: Cross-engine aggregated search
 * - openserp_image_search: Image search across engines
 * - openserp_extract: URL to clean Markdown extraction
 *
 * OSS mode: when OPENSERP_API_KEY is not set, auto-uses http://localhost:7000.
 * User needs the OpenSERP backend running (docker/binary) for OSS mode.
 */

export const openserpMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@openserp/mcp'],
  environment: undefined,
};
