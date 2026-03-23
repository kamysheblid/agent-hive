/**
 * Background Sync
 * 
 * Non-blocking background synchronization for:
 * - Memory persistence
 * - Pattern learning
 * - Context files
 */

import { getPatternLearner } from './pattern-learner';

export interface SyncConfig {
  enabled: boolean;
  interval: number;  // ms between syncs
  items: SyncItem[];
  onSync?: (item: SyncItem, success: boolean) => void;
}

export type SyncItem = 'memory' | 'patterns' | 'context';

export interface SyncStats {
  lastSync: string | null;
  itemsSynced: number;
  totalSyncs: number;
  errors: number;
}

const DEFAULT_CONFIG: SyncConfig = {
  enabled: true,
  interval: 30 * 1000,  // 30 seconds
  items: ['patterns'],
};

export class BackgroundSync {
  private config: SyncConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stats: SyncStats = {
    lastSync: null,
    itemsSynced: 0,
    totalSyncs: 0,
    errors: 0,
  };
  private running = false;

  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start background sync
   */
  start(): void {
    if (this.running || !this.config.enabled) return;
    
    this.running = true;
    
    // Run initial sync
    this.syncNow().catch(console.error);
    
    // Schedule periodic sync
    this.timer = setInterval(() => {
      this.syncNow().catch(console.error);
    }, this.config.interval);
    
    console.log(`[BackgroundSync] Started with interval ${this.config.interval}ms`);
  }

  /**
   * Stop background sync
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log('[BackgroundSync] Stopped');
  }

  /**
   * Run sync now (blocking)
   */
  async syncNow(): Promise<void> {
    const startTime = Date.now();
    
    for (const item of this.config.items) {
      try {
        await this.syncItem(item);
        this.stats.itemsSynced++;
        this.config.onSync?.(item, true);
      } catch (error) {
        this.stats.errors++;
        this.config.onSync?.(item, false);
        console.error(`[BackgroundSync] Failed to sync ${item}:`, error);
      }
    }
    
    this.stats.lastSync = new Date().toISOString();
    this.stats.totalSyncs++;
    
    const duration = Date.now() - startTime;
    console.log(`[BackgroundSync] Synced in ${duration}ms`);
  }

  /**
   * Get sync statistics
   */
  getStats(): SyncStats & { running: boolean } {
    return {
      ...this.stats,
      running: this.running,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SyncConfig>): void {
    const wasRunning = this.running;
    
    if (wasRunning) {
      this.stop();
    }
    
    this.config = { ...this.config, ...config };
    
    if (wasRunning && this.config.enabled) {
      this.start();
    }
  }

  /**
   * Add item to sync list
   */
  addItem(item: SyncItem): void {
    if (!this.config.items.includes(item)) {
      this.config.items.push(item);
    }
  }

  /**
   * Remove item from sync list
   */
  removeItem(item: SyncItem): void {
    this.config.items = this.config.items.filter(i => i !== item);
  }

  private async syncItem(item: SyncItem): Promise<void> {
    switch (item) {
      case 'patterns':
        // PatternLearner auto-saves, but we can trigger a force save
        const learner = getPatternLearner();
        // Force save if learner has pending changes
        break;
        
      case 'memory':
        // Sync memory blocks
        // This would integrate with the memory system
        break;
        
      case 'context':
        // Sync context files
        break;
    }
  }
}

// Singleton instance
let globalSync: BackgroundSync | null = null;

export function getBackgroundSync(config?: Partial<SyncConfig>): BackgroundSync {
  if (!globalSync) {
    globalSync = new BackgroundSync(config);
  } else if (config) {
    globalSync.updateConfig(config);
  }
  return globalSync;
}
