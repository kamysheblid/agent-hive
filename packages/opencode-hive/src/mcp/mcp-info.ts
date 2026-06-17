import * as fs from 'fs';
import * as path from 'path';

/**
 * MCP Guide for Agents
 * 
 * This module provides MCP information to agents for better tool selection.
 */

const MCP_GUIDE_PATH = path.join(__dirname, 'mcp-guide.md');

/**
 * Get the MCP guide content
 */
export function getMcpGuide(): string {
  try {
    return fs.readFileSync(MCP_GUIDE_PATH, 'utf-8');
  } catch {
    return getDefaultMcpGuide();
  }
}

/**
 * Get MCP info for a specific agent type
 */
export function getMcpGuideForAgent(agentName: string): string {
  const fullGuide = getMcpGuide();
  
  // For Scout/Researcher agents - give full guide
  if (agentName.includes('scout') || agentName.includes('researcher')) {
    return fullGuide;
  }
  
  // For Forager/Worker agents - give concise reference
  if (agentName.includes('forager') || agentName.includes('worker')) {
    return getConciseMcpGuide();
  }
  
  // For other agents - brief overview
  return getBriefMcpGuide();
}

/**
 * Concise MCP guide for workers
 */
function getConciseMcpGuide(): string {
  return `## MCP Quick Reference

Use MCPs strategically based on task:

| Task | Use This MCP |
|------|--------------|
| Find code | \`ast_grep\` or \`grep_app\` |
| Code patterns | \`grep_app\` |
| Refactoring | \`ast_grep_rewrite_code\` |
| Library docs | \`context7\` |
| Web info | \`websearch\` |
| Web scraping | \`crw_scrape\` / \`crw_crawl\` |
| DuckDuckGo search | \`ddg_search\` / \`ddg_get_answer\` |

**Tips:**
- ast_grep is fastest (local, 52x faster than regex)
- grep_app for GitHub code patterns
- context7 for official library docs
`;
}

/**
 * Brief MCP overview
 */
function getBriefMcpGuide(): string {
  return `## MCP Available

Tools enhanced by MCP servers:
- **websearch**: Web search (Exa AI)
- **crw**: Web scraping & crawling (Firecrawl alternative)
- **ddg**: DuckDuckGo search (free, no API key)
- **context7**: Library documentation
- **grep_app**: GitHub code search
- **ast_grep**: Fast code analysis (native)

Use \`skill_mcp\` tool to use MCPs directly.`;
}

/**
 * Default MCP guide if file not found
 */
function getDefaultMcpGuide(): string {
  return `## MCP Servers

Available MCP servers for enhanced capabilities:

1. **websearch** - Web search and current information
2. **crw** - Web scraping & crawling (Firecrawl alternative)
3. **context7** - Official library documentation
4. **grep_app** - GitHub code search
5. **ast_grep** - AST-based code analysis (fastest)

Use the appropriate MCP for your task:
- Research → websearch, context7
- Scraping/Crawling → crw, ddg (fetch)
- Implementation → ast_grep, grep_app
- Debugging → ast_grep, context7
`;
}

/**
 * MCP Tool Information
 */
export interface McpTool {
  name: string;
  mcp: string;
  description: string;
  category: 'search' | 'analysis' | 'discovery' | 'docs';
}

/**
 * List of all MCP tools with descriptions
 */
export const MCP_TOOLS: McpTool[] = [
  // Web Search
  { name: 'websearch', mcp: 'websearch', description: 'Web search', category: 'search' },
  { name: 'websearch_web_search_exa', mcp: 'websearch', description: 'Code-specific web search', category: 'search' },
  
  // Context7
  { name: 'context7_resolve-library-id', mcp: 'context7', description: 'Resolve library to Context7 ID', category: 'docs' },
  { name: 'context7_query-docs', mcp: 'context7', description: 'Query official documentation', category: 'docs' },
  
  // GitHub Code Search
  { name: 'grep_app_searchGitHub', mcp: 'grep_app', description: 'Search GitHub code patterns', category: 'search' },
  
  // Repomix
  { name: 'pack_codebase', mcp: 'repomix', description: 'Pack a local directory for AI analysis', category: 'discovery' },
  { name: 'pack_remote_repository', mcp: 'repomix', description: 'Clone and pack a remote GitHub repo', category: 'discovery' },
  { name: 'grep_repomix_output', mcp: 'repomix', description: 'Search patterns in repomix-packed output', category: 'search' },


  // CRW (web scraping & crawling)
  { name: 'crw_scrape', mcp: 'crw', description: 'Scrape single URL to markdown/HTML/links', category: 'search' },
  { name: 'crw_crawl', mcp: 'crw', description: 'Start async BFS crawl of a website', category: 'discovery' },
  { name: 'crw_check_crawl_status', mcp: 'crw', description: 'Poll crawl job status and get results', category: 'discovery' },
  { name: 'crw_map', mcp: 'crw', description: 'Discover all URLs on a website', category: 'discovery' },
  { name: 'crw_search', mcp: 'crw', description: 'Web search via CRW', category: 'search' },
  { name: 'crw_parse_file', mcp: 'crw', description: 'Parse local PDF (base64) to markdown', category: 'analysis' },

  // DDG (DuckDuckGo search)
  { name: 'ddg_get_answer', mcp: 'ddg', description: 'AI-powered answer with sources', category: 'search' },
  { name: 'ddg_search', mcp: 'ddg', description: 'Web search', category: 'search' },
  { name: 'ddg_search_news', mcp: 'ddg', description: 'News search', category: 'search' },
  { name: 'ddg_search_images', mcp: 'ddg', description: 'Image search', category: 'search' },
  { name: 'ddg_search_videos', mcp: 'ddg', description: 'Video search', category: 'search' },
  { name: 'ddg_fetch_content', mcp: 'ddg', description: 'Fetch URL to markdown', category: 'search' },
  { name: 'ddg_get_suggestions', mcp: 'ddg', description: 'Search suggestions', category: 'search' },
  { name: 'ddg_get_definition', mcp: 'ddg', description: 'Dictionary definition', category: 'docs' },
  { name: 'ddg_convert_currency', mcp: 'ddg', description: 'Currency conversion', category: 'analysis' },

  // ast_grep (Native)
  { name: 'ast_grep_find_code', mcp: 'ast_grep', description: 'Find code with AST patterns', category: 'analysis' },
  { name: 'ast_grep_rewrite_code', mcp: 'ast_grep', description: 'Transform code with AST', category: 'analysis' },
  { name: 'ast_grep_dump_syntax_tree', mcp: 'ast_grep', description: 'Inspect code structure', category: 'analysis' },
  { name: 'ast_grep_scan-code', mcp: 'ast_grep', description: 'Scan for code issues', category: 'analysis' },
  { name: 'ast_grep_analyze-imports', mcp: 'ast_grep', description: 'Analyze imports', category: 'analysis' },
];

/**
 * Get MCP tool info
 */
export function getMcpToolInfo(toolName: string): McpTool | undefined {
  return MCP_TOOLS.find(t => t.name === toolName);
}

/**
 * Get MCP tools by category
 */
export function getMcpToolsByCategory(category: McpTool['category']): McpTool[] {
  return MCP_TOOLS.filter(t => t.category === category);
}

/**
 * Get all MCP names
 */
export function getMcpNames(): string[] {
  return [...new Set(MCP_TOOLS.map(t => t.mcp))];
}

/**
 * Format MCP tools as XML for system prompts
 */
export function formatMcpToolsXml(): string {
  const tools = MCP_TOOLS.map(t => 
    `  <tool mcp="${t.mcp}">\n    <name>${t.name}</name>\n    <description>${t.description}</description>\n  </tool>`
  ).join('\n');
  
  return `\n<available_mcp_tools>\n${tools}\n</available_mcp_tools>`;
}
