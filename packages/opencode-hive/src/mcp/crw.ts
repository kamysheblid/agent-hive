import type { LocalMcpConfig } from './types';

/**
 * CRW MCP — web scraping & crawling via CRW backend
 *
 * Requires CRW_API_URL env var. CRW_API_KEY is optional.
 *
 * Tools:
 * - crw_scrape: Scrape URL → markdown/HTML/links
 * - crw_crawl: Async BFS crawl (returns job ID)
 * - crw_check_crawl_status: Poll crawl results
 * - crw_map: Discover all URLs on a site
 * - crw_search: Web search (needs configured backend)
 * - crw_parse_file: Parse local PDF (base64) to markdown
 */
export const crwMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', 'crw-mcp'],
  environment: {
    CRW_API_URL: process.env.CRW_API_URL,
    CRW_API_KEY: process.env.CRW_API_KEY,
  },
};
