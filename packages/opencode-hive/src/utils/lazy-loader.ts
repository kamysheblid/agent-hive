/**
 * Incremental Loader
 * 
 * Lazy loading with LRU cache for efficient resource management.
 * Used for skills, context files, and other resources.
 */

export interface LoaderConfig {
  maxCache: number;
  ttl?: number;  // Time to live in ms
  onEvict?: (key: string, value: unknown) => void;
}

const DEFAULT_CONFIG: LoaderConfig = {
  maxCache: 10,
};

/**
 * Generic incremental loader with LRU cache
 */
export class IncrementalLoader<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private accessOrder: string[] = [];
  private config: LoaderConfig;

  constructor(
    private loader: (key: string) => Promise<T> | T,
    config: Partial<LoaderConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get a value, loading if not cached
   */
  async get(key: string): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    // Check if cached and not expired
    if (cached) {
      if (this.config.ttl && (now - cached.timestamp) > this.config.ttl) {
        this.cache.delete(key);
      } else {
        // Update access order (move to end = most recently used)
        this.updateAccessOrder(key);
        return cached.value;
      }
    }

    // Load new value
    const value = await Promise.resolve(this.loader(key));
    
    // Evict if cache full
    if (this.cache.size >= this.config.maxCache) {
      this.evictOldest();
    }
    
    // Store in cache
    this.cache.set(key, { value, timestamp: now });
    this.accessOrder.push(key);
    
    return value;
  }

  /**
   * Check if key is cached (without loading)
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Invalidate a specific key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.accessOrder = this.accessOrder.filter(k => k !== key);
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];
    
    if (this.config.onEvict && size > 0) {
      this.config.onEvict('*', 'clear');
    }
  }

  /**
   * Preload multiple keys
   */
  async preload(keys: string[]): Promise<void> {
    await Promise.all(keys.map(key => this.get(key)));
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    cachedKeys: string[];
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCache,
      cachedKeys: Array.from(this.cache.keys()),
    };
  }

  private updateAccessOrder(key: string): void {
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
  }

  private evictOldest(): void {
    if (this.accessOrder.length === 0) return;
    
    const oldest = this.accessOrder.shift();
    if (oldest) {
      const cached = this.cache.get(oldest);
      if (cached) {
        if (this.config.onEvict) {
          this.config.onEvict(oldest, cached.value);
        }
        this.cache.delete(oldest);
      }
    }
  }
}

// Specialized loaders

/**
 * Skill template loader with incremental loading
 */
export class SkillLoader extends IncrementalLoader<string> {
  constructor() {
    super(async (skillId: string) => {
      // This would load from registry or file
      const { loadBuiltinSkill } = await import('../skills/builtin.js');
      const result = loadBuiltinSkill(skillId);
      if (!result.found || !result.skill) {
        throw new Error(`Skill not found: ${skillId}`);
      }
      return result.skill.template;
    }, { maxCache: 12 });  // Cache all 12 skills
  }
}

/**
 * Context file loader with incremental loading
 */
export class ContextLoader extends IncrementalLoader<string> {
  constructor(projectRoot: string) {
    super(async (filePath: string) => {
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.join(projectRoot, filePath);
      return fs.readFileSync(fullPath, 'utf-8');
    }, { maxCache: 20, ttl: 5 * 60 * 1000 });  // 5 min TTL
  }
}

/**
 * MCP tool loader with incremental loading
 */
export class McpToolLoader extends IncrementalLoader<unknown> {
  constructor() {
    super(async (mcpName: string) => {
      // Lazy load MCP tool
      const { getBuiltinMcps } = await import('../mcp/index.js');
      const mcps = getBuiltinMcps();
      const mcp = mcps[mcpName];
      if (!mcp) {
        throw new Error(`MCP not found: ${mcpName}`);
      }
      return mcp;
    }, { maxCache: 10 });
  }
}
