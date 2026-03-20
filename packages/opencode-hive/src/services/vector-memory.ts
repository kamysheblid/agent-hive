import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Vector Memory Service
 * 
 * Enhanced memory system using @sparkleideas/memory for:
 * - HNSW indexing for fast similarity search
 * - Vector embeddings for semantic search
 * - Hybrid SQLite + AgentDB backend
 * 
 * Falls back to simple file-based storage if @sparkleideas/memory unavailable.
 */

export interface MemoryMetadata {
  type?: 'decision' | 'learning' | 'preference' | 'blocker' | 'context' | 'pattern';
  scope?: string;
  tags?: string[];
  source?: string;
}

export interface VectorMemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: MemoryMetadata;
}

// Lazy-loaded memory instance
let memoryInstance: any = null;
let memoryInitPromise: Promise<void> | null = null;

/**
 * Initialize vector memory with lazy loading
 */
async function initMemory(options?: {
  indexPath?: string;
  dimensions?: number;
}): Promise<void> {
  if (memoryInstance !== null) {
    return;
  }
  
  if (memoryInitPromise !== null) {
    await memoryInitPromise;
    return;
  }
  
  memoryInitPromise = (async () => {
    try {
      // Dynamic require - only loads when needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const memory = require('@sparkleideas/memory');
      
      // Initialize with options
      const indexPath = options?.indexPath || path.join(os.homedir(), '.config', 'opencode', 'hive', 'vector-index');
      const dimensions = options?.dimensions || 384;
      
      // Ensure index directory exists
      fs.mkdirSync(indexPath, { recursive: true });
      
      // Initialize memory instance
      if (typeof memory.init === 'function') {
        await memory.init({
          indexPath,
          dimensions,
        });
      } else if (memory.default && typeof memory.default.init === 'function') {
        memoryInstance = memory.default;
        await memoryInstance.init({
          indexPath,
          dimensions,
        });
      } else {
        memoryInstance = memory;
      }
      
      console.log('[vector-memory] Initialized successfully');
    } catch (error) {
      console.warn('[vector-memory] Failed to initialize:', error instanceof Error ? error.message : error);
      memoryInstance = null;
    }
  })();
  
  await memoryInitPromise;
}

/**
 * Add a memory entry to the vector index
 */
export async function addMemory(
  content: string,
  metadata: MemoryMetadata = {}
): Promise<{ id: string; success: boolean; fallback?: boolean }> {
  // Try vector memory first
  await initMemory();
  
  if (memoryInstance) {
    try {
      const id = await memoryInstance.add({
        content,
        metadata,
      });
      
      return { id, success: true };
    } catch (error) {
      console.warn('[vector-memory] Failed to add with vector:', error instanceof Error ? error.message : error);
      // Fall through to fallback
    }
  }
  
  // Fallback: simple file-based storage
  return addMemoryFallback(content, metadata);
}

/**
 * Search memories using vector similarity
 */
export async function searchMemories(
  query: string,
  options: {
    limit?: number;
    type?: string;
    scope?: string;
    minScore?: number;
  } = {}
): Promise<{ results: SearchResult[]; fallback?: boolean }> {
  const { limit = 10, type, scope, minScore = 0.0 } = options;
  
  // Try vector memory first
  await initMemory();
  
  if (memoryInstance && typeof memoryInstance.search === 'function') {
    try {
      const searchResults = await memoryInstance.search(query, {
        limit,
        filter: { type, scope },
        minScore,
      });
      
      return {
        results: searchResults.map((r: any) => ({
          id: r.id,
          content: r.content,
          score: r.score || r.similarity || 0,
          metadata: r.metadata || {},
        })),
      };
    } catch (error) {
      console.warn('[vector-memory] Failed to search with vector:', error instanceof Error ? error.message : error);
      // Fall through to fallback
    }
  }
  
  // Fallback: simple text search
  return searchMemoriesFallback(query, { limit, type, scope });
}

/**
 * Get a memory entry by ID
 */
export async function getMemory(id: string): Promise<VectorMemoryEntry | null> {
  await initMemory();
  
  if (memoryInstance && typeof memoryInstance.get === 'function') {
    try {
      const entry = await memoryInstance.get(id);
      return entry;
    } catch {
      // Fall through to fallback
    }
  }
  
  // Fallback
  return getMemoryFallback(id);
}

/**
 * Delete a memory entry
 */
export async function deleteMemory(id: string): Promise<boolean> {
  await initMemory();
  
  if (memoryInstance && typeof memoryInstance.delete === 'function') {
    try {
      await memoryInstance.delete(id);
      return true;
    } catch {
      // Fall through to fallback
    }
  }
  
  // Fallback
  return deleteMemoryFallback(id);
}

/**
 * Get vector memory status
 */
export async function getMemoryStatus(): Promise<{
  available: boolean;
  type: 'vector' | 'fallback';
  stats?: {
    total: number;
    byType?: Record<string, number>;
  };
}> {
  await initMemory();
  
  if (memoryInstance) {
    try {
      const stats = await memoryInstance.stats?.() || {};
      return {
        available: true,
        type: 'vector',
        stats,
      };
    } catch {
      // Fall through
    }
  }
  
  // Check fallback storage
  const fallbackStats = getFallbackStats();
  return {
    available: false,
    type: 'fallback',
    stats: fallbackStats,
  };
}

// ============================================================================
// Fallback Implementation (Simple File-Based)
// ============================================================================

function getFallbackDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'hive', 'vector-memory', 'fallback');
}

function ensureFallbackDir(): void {
  const dir = getFallbackDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function addMemoryFallback(
  content: string,
  metadata: MemoryMetadata
): Promise<{ id: string; success: boolean; fallback: true }> {
  ensureFallbackDir();
  
  const id = generateId();
  const entry: VectorMemoryEntry = {
    id,
    content,
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const filePath = path.join(getFallbackDir(), `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  
  return { id, success: true, fallback: true };
}

async function searchMemoriesFallback(
  query: string,
  options: { limit?: number; type?: string; scope?: string }
): Promise<{ results: SearchResult[]; fallback: true }> {
  ensureFallbackDir();
  
  const { limit = 10, type, scope } = options;
  const queryLower = query.toLowerCase();
  const results: SearchResult[] = [];
  
  const files = fs.readdirSync(getFallbackDir()).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(getFallbackDir(), file), 'utf-8');
      const entry: VectorMemoryEntry = JSON.parse(content);
      
      // Filter by type and scope
      if (type && entry.metadata.type !== type) continue;
      if (scope && entry.metadata.scope !== scope) continue;
      
      // Simple text match scoring
      const contentLower = entry.content.toLowerCase();
      let score = 0;
      
      if (contentLower.includes(queryLower)) {
        score = queryLower.length / contentLower.length;
      }
      
      // Check metadata too
      if (entry.metadata.tags) {
        for (const tag of entry.metadata.tags) {
          if (tag.toLowerCase().includes(queryLower)) {
            score = Math.max(score, 0.8);
          }
        }
      }
      
      if (score > 0) {
        results.push({
          id: entry.id,
          content: entry.content,
          score,
          metadata: entry.metadata,
        });
      }
    } catch {
      // Skip invalid files
    }
  }
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  return {
    results: results.slice(0, limit),
    fallback: true,
  };
}

async function getMemoryFallback(id: string): Promise<VectorMemoryEntry | null> {
  const filePath = path.join(getFallbackDir(), `${id}.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function deleteMemoryFallback(id: string): Promise<boolean> {
  const filePath = path.join(getFallbackDir(), `${id}.json`);
  
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFallbackStats(): { total: number; byType: Record<string, number> } {
  ensureFallbackDir();
  
  const stats = { total: 0, byType: {} as Record<string, number> };
  
  const files = fs.readdirSync(getFallbackDir()).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(getFallbackDir(), file), 'utf-8');
      const entry: VectorMemoryEntry = JSON.parse(content);
      
      stats.total++;
      
      const type = entry.metadata.type || 'unknown';
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    } catch {
      // Skip invalid files
    }
  }
  
  return stats;
}

// ============================================================================
// Service Export
// ============================================================================

export const VectorMemoryService = {
  init: initMemory,
  add: addMemory,
  search: searchMemories,
  get: getMemory,
  delete: deleteMemory,
  status: getMemoryStatus,
};

export default VectorMemoryService;
