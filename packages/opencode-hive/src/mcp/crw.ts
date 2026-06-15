import type { LocalMcpConfig } from './types';

/**
 * CRW MCP — web scraping & crawling, no backend needed (embedded mode)
 *
 * Modes:
 * - Embedded (default): self-contained, zero setup, no env vars needed
 * - Proxy: forward to remote CRW server via CRW_API_URL + CRW_API_KEY
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
