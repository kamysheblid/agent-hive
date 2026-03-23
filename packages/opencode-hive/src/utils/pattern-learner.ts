/**
 * Pattern Learning System
 * 
 * Learns patterns from task execution to improve future suggestions.
 * Stores patterns in `.hive/patterns.json`.
 * 
 * Features:
 * - Track action sequences (what follows what)
 * - Calculate success rate per pattern
 * - Predict next actions based on context
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PatternLearned {
  id: string;
  pattern: string;         // e.g., "test after feature"
  trigger: string;        // What triggers this pattern
  action: string;         // The action to take
  frequency: number;      // How often this pattern occurs
  successCount: number;    // Times this pattern led to success
  lastSeen: string;       // ISO timestamp
  examples: string[];     // Example contexts
}

export interface PatternConfig {
  enabled: boolean;
  maxPatterns: number;
  minConfidence: number;  // 0-1, minimum success rate to suggest
  dataDir: string;
}

const DEFAULT_CONFIG: PatternConfig = {
  enabled: true,
  maxPatterns: 100,
  minConfidence: 0.6,
  dataDir: '.hive/patterns.json',
};

export class PatternLearner {
  private patterns: Map<string, PatternLearned> = new Map();
  private config: PatternConfig;
  private dataPath: string;
  private loaded = false;

  constructor(config: Partial<PatternConfig> = {}, projectRoot?: string) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const root = projectRoot || process.cwd();
    this.dataPath = path.join(root, this.config.dataDir);
  }

  /**
   * Load patterns from disk
   */
  load(): void {
    if (this.loaded) return;
    
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        for (const p of data.patterns || []) {
          this.patterns.set(p.id, p);
        }
      }
    } catch {
      // Start fresh if file corrupted
    }
    this.loaded = true;
  }

  /**
   * Save patterns to disk
   */
  private save(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        patterns: Array.from(this.patterns.values()),
      };
      
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[PatternLearner] Failed to save patterns:', e);
    }
  }

  /**
   * Learn a new pattern
   */
  learn(trigger: string, action: string, success: boolean, context?: string): void {
    this.load();
    
    const id = this.generateId(trigger, action);
    const existing = this.patterns.get(id);
    
    if (existing) {
      existing.frequency++;
      if (success) existing.successCount++;
      existing.lastSeen = new Date().toISOString();
      if (context && !existing.examples.includes(context)) {
        existing.examples.push(context);
        if (existing.examples.length > 5) {
          existing.examples = existing.examples.slice(-5);
        }
      }
    } else {
      const newPattern: PatternLearned = {
        id,
        pattern: `${trigger} → ${action}`,
        trigger,
        action,
        frequency: 1,
        successCount: success ? 1 : 0,
        lastSeen: new Date().toISOString(),
        examples: context ? [context] : [],
      };
      
      this.patterns.set(id, newPattern);
      
      // Evict old patterns if too many
      if (this.patterns.size > this.config.maxPatterns) {
        this.evictOldestPattern();
      }
    }
    
    this.save();
  }

  /**
   * Predict next actions based on context
   */
  predict(context: string): PatternLearned[] {
    this.load();
    
    const contextLower = context.toLowerCase();
    const matches: PatternLearned[] = [];
    
    for (const pattern of this.patterns.values()) {
      // Check if trigger matches context
      if (contextLower.includes(pattern.trigger.toLowerCase()) ||
          pattern.trigger.toLowerCase().includes(contextLower)) {
        
        const confidence = pattern.successCount / pattern.frequency;
        if (confidence >= this.config.minConfidence) {
          matches.push(pattern);
        }
      }
    }
    
    // Sort by confidence then frequency
    return matches.sort((a, b) => {
      const confA = a.successCount / a.frequency;
      const confB = b.successCount / b.frequency;
      if (confB !== confA) return confB - confA;
      return b.frequency - a.frequency;
    });
  }

  /**
   * Get the most successful patterns
   */
  getTopPatterns(limit = 5): PatternLearned[] {
    this.load();
    
    const sorted = Array.from(this.patterns.values())
      .filter(p => p.frequency >= 2)
      .sort((a, b) => {
        const confA = a.successCount / a.frequency;
        const confB = b.successCount / b.frequency;
        return confB - confA;
      });
    
    return sorted.slice(0, limit);
  }

  /**
   * Export all patterns for AGENTS.md sync
   */
  exportPatterns(): PatternLearned[] {
    this.load();
    return Array.from(this.patterns.values());
  }

  /**
   * Import patterns (for team sharing)
   */
  importPatterns(patterns: PatternLearned[]): void {
    this.load();
    
    for (const p of patterns) {
      const existing = this.patterns.get(p.id);
      if (!existing || existing.frequency < p.frequency) {
        this.patterns.set(p.id, p);
      }
    }
    
    this.save();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPatterns: number;
    avgConfidence: number;
    mostSuccessful: PatternLearned | null;
    recentPatterns: PatternLearned[];
  } {
    this.load();
    
    const patterns = Array.from(this.patterns.values());
    const avgConfidence = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + (p.successCount / p.frequency), 0) / patterns.length
      : 0;
    
    const sorted = patterns.sort((a, b) => 
      new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
    
    return {
      totalPatterns: patterns.length,
      avgConfidence,
      mostSuccessful: patterns.length > 0
        ? patterns.sort((a, b) => 
            (b.successCount / b.frequency) - (a.successCount / a.frequency)
          )[0]
        : null,
      recentPatterns: sorted.slice(0, 5),
    };
  }

  /**
   * Clear all patterns
   */
  clear(): void {
    this.patterns.clear();
    this.save();
  }

  // Private helpers
  
  private generateId(trigger: string, action: string): string {
    return Buffer.from(`${trigger}:${action}`).toString('base64').slice(0, 32);
  }
  
  private evictOldestPattern(): void {
    let oldest: PatternLearned | null = null;
    let oldestTime = Infinity;
    
    for (const p of this.patterns.values()) {
      const time = new Date(p.lastSeen).getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldest = p;
      }
    }
    
    if (oldest) {
      this.patterns.delete(oldest.id);
    }
  }
}

// Singleton instance
let globalLearner: PatternLearner | null = null;

export function getPatternLearner(projectRoot?: string): PatternLearner {
  if (!globalLearner) {
    globalLearner = new PatternLearner({}, projectRoot);
  }
  return globalLearner;
}
