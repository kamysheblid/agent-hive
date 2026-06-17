import type { LocalMcpConfig } from './types';

/**
 * DDG Search MCP — DuckDuckGo search via ddg-search-mcp
 *
 * Free, no API key needed. Powered by DuckDuckGo's undocumented endpoints.
 *
 * Tools:
 * - ddg_get_answer: AI answer with sources (like Exa Answer API)
 * - ddg_search: Web search (organic results)
 * - ddg_search_news: News search
 * - ddg_search_images: Image search
 * - ddg_search_videos: Video search
 * - ddg_fetch_content: URL content extraction
 * - ddg_get_suggestions: Search suggestions
 * - ddg_get_definition: Dictionary definition
 * - ddg_convert_currency: Currency conversion
 */
export const ddgMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', 'ddg-search-mcp'],
  environment: {},
};
