import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { VectorMemoryService, type MemoryMetadata } from '../services/vector-memory.js';

/**
 * Vector Memory Tools
 * 
 * Enhanced memory search using vector embeddings and HNSW indexing.
 * Falls back to simple text search if @sparkleideas/memory unavailable.
 */

export const hiveVectorSearchTool: ToolDefinition = tool({
  description: `Semantic memory search using vector embeddings.

**Features:**
- HNSW indexing for fast similarity search
- Semantic matching (finds conceptually similar content)
- Filter by type and scope
- Fallback to text search if vector unavailable

**Types:**
- decision: Architectural decisions, design choices
- learning: Insights, discoveries, patterns found
- preference: User preferences, coding style
- blocker: Known blockers, workarounds
- context: Important context about the project
- pattern: Code patterns, recurring solutions`,

  args: {
    query: tool.schema.string().describe('Search query (semantic or keyword)'),
    type: tool.schema.enum(['decision', 'learning', 'preference', 'blocker', 'context', 'pattern']).optional().describe('Filter by memory type'),
    scope: tool.schema.string().optional().describe('Filter by scope (e.g., auth, api, ui)'),
    limit: tool.schema.number().optional().describe('Maximum results (default: 10)'),
  },

  async execute({ query, type, scope, limit = 10 }) {
    const result = await VectorMemoryService.search(query, {
      limit,
      type,
      scope,
    });

    if (result.results.length === 0) {
      return JSON.stringify({
        message: 'No matching memories found',
        query,
        fallback: result.fallback || false,
        tips: [
          'Try different keywords',
          'Use broader search terms',
          'Create memories with hive_memory_set first',
        ],
      }, null, 2);
    }

    return JSON.stringify({
      total: result.results.length,
      query,
      fallback: result.fallback || false,
      results: result.results.map(r => ({
        id: r.id,
        content: r.content,
        score: Math.round(r.score * 100) / 100,
        type: r.metadata.type,
        scope: r.metadata.scope,
        tags: r.metadata.tags,
      })),
    }, null, 2);
  },
});

export const hiveVectorAddTool: ToolDefinition = tool({
  description: `Add a memory with semantic indexing for future search.

**Metadata:**
- type: Categorize the memory
- scope: Project area or component
- tags: Additional categorization

**Example:**
\`\`\`
Content: "Use async/await instead of .then() chains"
Type: learning
Scope: async-patterns
Tags: javascript, promises, best-practice
\`\`\``,

  args: {
    content: tool.schema.string().describe('Memory content to store'),
    type: tool.schema.enum(['decision', 'learning', 'preference', 'blocker', 'context', 'pattern']).optional().describe('Memory type'),
    scope: tool.schema.string().optional().describe('Scope (e.g., auth, api, ui)'),
    tags: tool.schema.array(tool.schema.string()).optional().describe('Tags for categorization'),
  },

  async execute({ content, type, scope, tags }) {
    const metadata: MemoryMetadata = {};
    
    if (type) metadata.type = type;
    if (scope) metadata.scope = scope;
    if (tags) metadata.tags = tags;

    const result = await VectorMemoryService.add(content, metadata);

    return JSON.stringify({
      success: result.success,
      id: result.id,
      fallback: result.fallback || false,
      message: `Memory stored${result.fallback ? ' (text search mode)' : ' (vector indexed)'}`,
    }, null, 2);
  },
});

export const hiveVectorStatusTool: ToolDefinition = tool({
  description: `Check vector memory status and statistics.

**Returns:**
- available: Whether @sparkleideas/memory is working
- type: vector or fallback
- stats: Memory counts by type`,

  args: {},

  async execute() {
    const status = await VectorMemoryService.status();

    return JSON.stringify({
      status: status.available ? 'ready' : 'fallback',
      type: status.type,
      backend: status.available 
        ? '@sparkleideas/memory (HNSW + Vector)'
        : 'Simple text search',
      stats: status.stats,
      tips: status.available
        ? []
        : [
            'Install @sparkleideas/memory for vector search',
            'npm install @sparkleideas/memory',
          ],
    }, null, 2);
  },
});
