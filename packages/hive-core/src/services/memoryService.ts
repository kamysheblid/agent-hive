/**
 * Memory Service with Session Summarization
 * 
 * Provides persistent memory across sessions with:
 * - Session-based storage (keyed by session ID for long-term storage)
 * - Automatic conversation summarization
 * - Integration with OpenCode's database
 * - Context persistence across sessions
 */

import * as fs from 'fs';
import * as path from 'path';
import { getContextPath, ensureDir, fileExists, readText, writeText, getHivePath } from '../utils/paths.js';

export interface MemoryEntry {
  id: string;
  sessionId: string;
  featureName?: string;
  type: 'summary' | 'learnings' | 'decisions' | 'context';
  content: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface MemorySummary {
  sessionId: string;
  featureName?: string;
  summary: string;
  keyLearnings: string[];
  decisions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryConfig {
  /** Enable automatic summarization */
  autoSummarize?: boolean;
  /** Summarize after N messages */
  summarizeAfterMessages?: number;
  /** Maximum summary length */
  maxSummaryLength?: number;
  /** Store in OpenCode database path */
  useOpencodeDb?: boolean;
}

const DEFAULT_CONFIG: Required<MemoryConfig> = {
  autoSummarize: true,
  summarizeAfterMessages: 20,
  maxSummaryLength: 5000,
  useOpencodeDb: true,
};

export class MemoryService {
  private projectRoot: string;
  private config: Required<MemoryConfig>;

  constructor(projectRoot: string, config: MemoryConfig = DEFAULT_CONFIG) {
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the memory storage path
   * 
   * Storage: .hive/memory/ folder (project-scoped)
   * 
   * For cross-session persistence, memories are stored keyed by session ID
   * in .hive/memory/sessions/<session_prefix>/
   */
  private getMemoryPath(): string {
    // Use .hive/memory/ folder for storage (project-scoped)
    return path.join(getHivePath(this.projectRoot), 'memory');
  }

  /**
   * Get memory path for a specific session
   */
  private getSessionMemoryPath(sessionId: string): string {
    const memoryDir = this.getMemoryPath();
    // Organize by session ID for long-term storage
    return path.join(memoryDir, 'sessions', sessionId.slice(0, 8));
  }

  /**
   * Store a memory entry
   */
  write(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): string {
    const memoryDir = this.getSessionMemoryPath(entry.sessionId);
    ensureDir(memoryDir);

    const now = new Date().toISOString();
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const fullEntry: MemoryEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };

    const filePath = path.join(memoryDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullEntry, null, 2));

    return filePath;
  }

  /**
   * Read a memory entry
   */
  read(entryId: string, sessionId: string): MemoryEntry | null {
    const memoryDir = this.getSessionMemoryPath(sessionId);
    const filePath = path.join(memoryDir, `${entryId}.json`);
    
    if (!fileExists(filePath)) return null;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as MemoryEntry;
  }

  /**
   * List all memories for a session
   */
  list(sessionId: string, type?: MemoryEntry['type']): MemoryEntry[] {
    const memoryDir = this.getSessionMemoryPath(sessionId);
    if (!fs.existsSync(memoryDir)) return [];

    const files = fs.readdirSync(memoryDir)
      .filter(f => f.endsWith('.json'));
    
    const memories: MemoryEntry[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(memoryDir, file), 'utf-8');
        const entry = JSON.parse(content) as MemoryEntry;
        if (!type || entry.type === type) {
          memories.push(entry);
        }
      } catch {
        // Skip invalid files
      }
    }

    return memories.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get all memories across all sessions (for cross-session context)
   */
  getAllMemories(featureName?: string): MemoryEntry[] {
    const memoryDir = this.getMemoryPath();
    if (!fs.existsSync(memoryDir)) return [];

    const allMemories: MemoryEntry[] = [];
    
    // Recursively find all memory files
    const findMemories = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findMemories(fullPath);
        } else if (entry.name.endsWith('.json')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const memory = JSON.parse(content) as MemoryEntry;
            if (!featureName || memory.featureName === featureName) {
              allMemories.push(memory);
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    };

    findMemories(memoryDir);
    
    return allMemories.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Create a summary of conversation
   */
  async summarize(
    sessionId: string,
    messages: { role: string; content: string }[],
    featureName?: string
  ): Promise<string> {
    if (messages.length < this.config.summarizeAfterMessages) {
      return '';
    }

    // Extract key information from recent messages
    const recentMessages = messages.slice(-this.config.summarizeAfterMessages);
    
    // Find key learnings (look for file changes, decisions, discoveries)
    const keyLearnings: string[] = [];
    const decisions: string[] = [];
    
    for (const msg of recentMessages) {
      if (msg.role === 'assistant') {
        // Look for tool calls that indicate learning
        if (msg.content.includes('Created') || msg.content.includes('Modified')) {
          keyLearnings.push(msg.content.slice(0, 200));
        }
        if (msg.content.includes('Decision:') || msg.content.includes('decided')) {
          decisions.push(msg.content.slice(0, 200));
        }
      }
    }

    // Create summary content
    const summaryContent = this.createSummaryContent(sessionId, recentMessages, keyLearnings, decisions);

    // Store the summary
    this.write({
      sessionId,
      featureName,
      type: 'summary',
      content: summaryContent,
      tags: ['auto-summary'],
    });

    return summaryContent;
  }

  /**
   * Create formatted summary content
   */
  private createSummaryContent(
    sessionId: string,
    messages: { role: string; content: string }[],
    keyLearnings: string[],
    decisions: string[]
  ): string {
    const messageCount = messages.length;
    const firstMsg = messages[0]?.content?.slice(0, 100) || '';
    const lastMsg = messages[messages.length - 1]?.content?.slice(0, 100) || '';

    return `# Session Summary (${sessionId})

**Created:** ${new Date().toISOString()}
**Messages:** ${messageCount}

## Overview
- Started with: ${firstMsg}...
- Most recent: ${lastMsg}...

## Key Learnings
${keyLearnings.slice(0, 5).map((l, i) => `${i + 1}. ${l}`).join('\n') || 'None recorded'}

## Decisions Made
${decisions.slice(0, 5).map((d, i) => `${i + 1}. ${d}`).join('\n') || 'None recorded'}

## Tool Usage Summary
- Files created/modified: ${keyLearnings.length}
- Decisions recorded: ${decisions.length}

---
*This summary was auto-generated by Hive Memory System*
`;
  }

  /**
   * Store learnings (from hive_context_write)
   */
  storeLearnings(sessionId: string, content: string, featureName?: string): string {
    return this.write({
      sessionId,
      featureName,
      type: 'learnings',
      content,
      tags: ['learnings'],
    });
  }

  /**
   * Store decisions
   */
  storeDecision(sessionId: string, decision: string, featureName?: string): string {
    return this.write({
      sessionId,
      featureName,
      type: 'decisions',
      content: decision,
      tags: ['decision'],
    });
  }

  /**
   * Get summary for a session
   */
  getSummary(sessionId: string): MemorySummary | null {
    const memories = this.list(sessionId, 'summary');
    const summary = memories[0];
    
    if (!summary) return null;

    // Extract key learnings and decisions
    const allMemories = this.list(sessionId);
    const learnings = allMemories
      .filter(m => m.type === 'learnings')
      .map(m => m.content);
    const decisions = allMemories
      .filter(m => m.type === 'decisions')
      .map(m => m.content);

    return {
      sessionId: summary.sessionId,
      featureName: summary.featureName,
      summary: summary.content,
      keyLearnings: learnings.slice(0, 10),
      decisions: decisions.slice(0, 10),
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    };
  }

  /**
   * Delete a memory entry
   */
  delete(entryId: string, sessionId: string): boolean {
    const memoryDir = this.getSessionMemoryPath(sessionId);
    const filePath = path.join(memoryDir, `${entryId}.json`);
    
    if (fileExists(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * Clear all memories for a session
   */
  clear(sessionId: string): number {
    const memories = this.list(sessionId);
    let count = 0;
    
    for (const mem of memories) {
      if (this.delete(mem.id, sessionId)) {
        count++;
      }
    }
    
    return count;
  }

  /**
   * Get memory statistics
   */
  stats(): { totalMemories: number; sessions: number; byType: Record<string, number> } {
    const allMemories = this.getAllMemories();
    const sessions = new Set(allMemories.map(m => m.sessionId));
    
    const byType: Record<string, number> = {};
    for (const mem of allMemories) {
      byType[mem.type] = (byType[mem.type] || 0) + 1;
    }

    return {
      totalMemories: allMemories.length,
      sessions: sessions.size,
      byType,
    };
  }

  /**
   * Search memories across all sessions
   */
  search(query: string, featureName?: string): MemoryEntry[] {
    const allMemories = this.getAllMemories(featureName);
    const lowerQuery = query.toLowerCase();
    
    return allMemories.filter(m => 
      m.content.toLowerCase().includes(lowerQuery) ||
      m.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }
}

/**
 * Create memory service with default config
 */
export function createMemoryService(projectRoot: string): MemoryService {
  return new MemoryService(projectRoot);
}
