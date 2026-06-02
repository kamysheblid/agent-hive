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
  
  describe('listMemories', () => {
    test('should list recent memories by recency', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      await VectorMemoryService.add('First memory', { type: 'learning' });
      await VectorMemoryService.add('Second memory', { type: 'decision' });
      await VectorMemoryService.add('Third memory', { type: 'context' });

      const results = await VectorMemoryService.list({ limit: 10 });

      expect(results.results).toBeDefined();
      expect(Array.isArray(results.results)).toBe(true);
      expect(results.results.length).toBeGreaterThanOrEqual(3);
      // Should have scores (1.0 for fallback)
      expect(results.results[0].score).toBeGreaterThan(0);
    });

    test('should filter by type', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      await VectorMemoryService.add('Learning about X', { type: 'learning' });
      await VectorMemoryService.add('Decision about Y', { type: 'decision' });
      await VectorMemoryService.add('Context about Z', { type: 'context' });

      const results = await VectorMemoryService.list({ type: 'decision' });

      expect(results.results.length).toBeGreaterThanOrEqual(1);
      for (const result of results.results) {
        expect(result.metadata.type).toBe('decision');
      }
    });

    test('should respect limit', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      await VectorMemoryService.add('Memory entry 1', { type: 'learning' });
      await VectorMemoryService.add('Memory entry 2', { type: 'learning' });
      await VectorMemoryService.add('Memory entry 3', { type: 'learning' });

      const results = await VectorMemoryService.list({ limit: 2 });

      expect(results.results.length).toBeLessThanOrEqual(2);
    });

    test('should return results with correct structure even when store has data', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      // Note: fallback dir is shared across tests, so store likely has data from prior tests
      const results = await VectorMemoryService.list({ limit: 10 });

      expect(results.results).toBeDefined();
      expect(Array.isArray(results.results)).toBe(true);
      // Each result should have required fields
      if (results.results.length > 0) {
        for (const r of results.results) {
          expect(r).toHaveProperty('id');
          expect(r).toHaveProperty('content');
          expect(r).toHaveProperty('score');
          expect(r).toHaveProperty('metadata');
        }
      }
    });

    test('should filter by scope', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      await VectorMemoryService.add('Auth decision', { type: 'decision', scope: 'auth' });
      await VectorMemoryService.add('API design patterns', { type: 'decision', scope: 'api' });
      await VectorMemoryService.add('Auth flow patterns', { type: 'learning', scope: 'auth' });

      const results = await VectorMemoryService.list({ scope: 'auth' });

      expect(results.results.length).toBeGreaterThanOrEqual(2);
      for (const result of results.results) {
        expect(result.metadata.scope).toBe('auth');
      }
    });

    test('should filter by type and scope combined', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      await VectorMemoryService.add('Auth decision', { type: 'decision', scope: 'auth' });
      await VectorMemoryService.add('API decision', { type: 'decision', scope: 'api' });
      await VectorMemoryService.add('Auth learning', { type: 'learning', scope: 'auth' });

      const results = await VectorMemoryService.list({ type: 'decision', scope: 'auth' });

      expect(results.results.length).toBeGreaterThanOrEqual(1);
      for (const result of results.results) {
        expect(result.metadata.type).toBe('decision');
        expect(result.metadata.scope).toBe('auth');
      }
    });

    test('should return results with correct metadata fields', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      // Use a unique scope to isolate from other tests sharing the same fallback dir
      const uniqueScope = `test-meta-${Date.now()}`;
      await VectorMemoryService.add('Test with metadata', {
        type: 'learning',
        scope: uniqueScope,
        tags: ['tag1', 'tag2'],
      });

      const results = await VectorMemoryService.list({ scope: uniqueScope, limit: 10 });

      expect(results.results.length).toBeGreaterThanOrEqual(1);
      const entry = results.results[0];
      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('Test with metadata');
      expect(entry.metadata.type).toBe('learning');
      expect(entry.metadata.scope).toBe(uniqueScope);
      expect(entry.metadata.tags).toEqual(['tag1', 'tag2']);
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

  describe('Quality guards', () => {
    test('should reject content that is too short', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const result = await VectorMemoryService.add('short', { type: 'learning' });

      expect(result.rejected).toBe(true);
      expect(result.reason).toContain('too short');
      expect(result.success).toBe(false);
    });

    test('should reject content with repeated chars', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const result = await VectorMemoryService.add('aaaaaaaaaaaaaaa', { type: 'learning' });

      expect(result.rejected).toBe(true);
      expect(result.reason).toContain('repeated');
    });

    test('should accept good quality content', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const scope = `quality-test-${Date.now()}`;
      const result = await VectorMemoryService.add(
        'This is good quality content with meaningful information for testing',
        { type: 'learning', scope }
      );

      expect(result.rejected).toBeUndefined();
      expect(result.success).toBe(true);
    });
  });

  describe('Deduplication', () => {
    test('should reject exact duplicate content', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const content = `Unique test content for dedup ${Date.now()}`;
      const scope = `dedup-test-${Date.now()}`;

      // First add should succeed
      const first = await VectorMemoryService.add(content, { type: 'learning', scope });
      expect(first.success).toBe(true);

      // Second add with same content should be rejected as duplicate
      const second = await VectorMemoryService.add(content, { type: 'learning', scope });
      expect(second.rejected).toBe(true);
      expect(second.reason).toContain('duplicate');
    });

    test('should allow different content even with same scope', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const scope = `dedup-diff-${Date.now()}`;

      const first = await VectorMemoryService.add('First unique memory content for dedup test', { type: 'learning', scope });
      expect(first.success).toBe(true);

      const second = await VectorMemoryService.add('Second different memory content for dedup test', { type: 'learning', scope });
      expect(second.success).toBe(true);
      expect(second.rejected).toBeUndefined();
    });
  });

  describe('Sharding', () => {
    test('should use sharded directory structure', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const scope = `shard-test-${Date.now()}`;
      const result = await VectorMemoryService.add(
        'Sharding test memory content',
        { type: 'learning', scope }
      );

      expect(result.success).toBe(true);
      // Should be findable via sharded listing
      const list = await VectorMemoryService.list({ scope, limit: 5 });
      expect(list.results.length).toBeGreaterThanOrEqual(1);
      expect(list.results[0].content).toContain('Sharding test');
    });

    test('should report shard info in status', async () => {
      const { VectorMemoryService } = await import('../services/vector-memory.js');

      const status = await VectorMemoryService.status();

      // In fallback mode, should have shard info
      if (status.type === 'fallback') {
        expect(status.shard).toBeDefined();
        expect(status.shard!.index).toBeGreaterThanOrEqual(1);
        expect(status.shard!.maxEntries).toBeGreaterThan(0);
      }
    });
  });
});
