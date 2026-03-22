import { describe, test, expect, beforeEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Vector Memory Service', () => {
  const testDir = path.join(os.tmpdir(), 'hive-vector-memory-test');
  
  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });
  
  describe('addMemory', () => {
    test('should add memory with fallback storage', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');
      
      // Force fallback mode by not having @sparkleideas/memory
      const result = await VectorMemoryService.add('Test memory content', {
        type: 'learning',
        scope: 'test',
      });
      
      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      expect(result.fallback).toBe(true);
    });
    
    test('should accept metadata', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');
      
      const result = await VectorMemoryService.add('Content with metadata', {
        type: 'decision',
        scope: 'api',
        tags: ['important', 'review'],
      });
      
      expect(result.success).toBe(true);
    });
  });
  
  describe('searchMemories', () => {
    test('should return search results', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');
      
      // Add some memories first
      await VectorMemoryService.add('JavaScript async patterns', {
        type: 'learning',
        scope: 'async',
      });
      
      await VectorMemoryService.add('Python best practices', {
        type: 'learning',
        scope: 'python',
      });
      
      const results = await VectorMemoryService.search('JavaScript', { limit: 10 });
      
      expect(results.results).toBeDefined();
      expect(Array.isArray(results.results)).toBe(true);
      expect(results.fallback).toBe(true);
    });
    
    test('should filter by type', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');
      
      await VectorMemoryService.add('Decision content', { type: 'decision' });
      await VectorMemoryService.add('Learning content', { type: 'learning' });
      
      const results = await VectorMemoryService.search('content', { 
        type: 'decision',
        limit: 10 
      });
      
      // All results should be decisions
      for (const result of results.results) {
        expect(result.metadata.type).toBe('decision');
      }
    });
  });
  
  describe('getMemoryStatus', () => {
    test('should return status', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');
      
      const status = await VectorMemoryService.status();
      
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('type');
      // Type depends on whether @sparkleideas/memory is installed
      expect(['fallback', 'vector']).toContain(status.type);
    });
  });
});
