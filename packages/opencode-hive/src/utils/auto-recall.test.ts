import { describe, test, expect } from 'bun:test';
import { formatAutoRecallInjection, buildCaptureSnapshot } from './auto-recall.js';
import type { SearchResult } from '../services/vector-memory.js';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'test-id',
    content: 'Test memory content',
    score: 1.0,
    metadata: {},
    ...overrides,
  };
}

// ============================================================================
// formatAutoRecallInjection
// ============================================================================
describe('formatAutoRecallInjection', () => {
  test('returns empty string for empty results', () => {
    expect(formatAutoRecallInjection([])).toBe('');
  });

  test('returns empty string for null/undefined', () => {
    expect(formatAutoRecallInjection(null as unknown as SearchResult[])).toBe('');
    expect(formatAutoRecallInjection(undefined as unknown as SearchResult[])).toBe('');
  });

  test('includes header and description', () => {
    const result = formatAutoRecallInjection([makeResult()]);
    expect(result).toMatch(/### Auto-Recalled Vector Memories/);
    expect(result).toMatch(/hive_vector_add/);
  });

  test('formats a single memory without type/scope', () => {
    const result = formatAutoRecallInjection([makeResult({ content: 'Hello world' })]);
    // No extra spaces before content when no type/scope labels
    expect(result).toMatch(/- Hello world/);
    expect(result).not.toMatch(/-  Hello world/); // no double space
  });

  test('includes type label when present', () => {
    const result = formatAutoRecallInjection([
      makeResult({ content: 'Some learning', metadata: { type: 'learning' } }),
    ]);
    expect(result).toMatch(/\[learning\]/);
    expect(result).toMatch(/Some learning/);
  });

  test('includes scope label when present', () => {
    const result = formatAutoRecallInjection([
      makeResult({ content: 'Auth stuff', metadata: { scope: 'auth' } }),
    ]);
    expect(result).toMatch(/\(auth\)/);
    expect(result).toMatch(/Auth stuff/);
  });

  test('includes both type and scope labels', () => {
    const result = formatAutoRecallInjection([
      makeResult({
        content: 'API design decision',
        metadata: { type: 'decision', scope: 'api' },
      }),
    ]);
    expect(result).toMatch(/\[decision\] \(api\) API design decision/);
  });

  test('truncates content exceeding max length', () => {
    const longContent = 'x'.repeat(500);
    const result = formatAutoRecallInjection([makeResult({ content: longContent })], 100);
    expect(result).toMatch(/x{100}\.\.\./);
    expect(result.length).toBeLessThan(longContent.length + 200);
  });

  test('does not truncate content within max length', () => {
    const shortContent = 'Short memory';
    const result = formatAutoRecallInjection([makeResult({ content: shortContent })], 300);
    expect(result).toContain(shortContent);
    expect(result).not.toContain('...');
  });

  test('handles multiple memories in order', () => {
    const results = [
      makeResult({ content: 'First', metadata: { type: 'learning' } }),
      makeResult({ content: 'Second', metadata: { type: 'decision' } }),
      makeResult({ content: 'Third', metadata: { type: 'context' } }),
    ];
    const result = formatAutoRecallInjection(results);
    const lines = result.split('\n').filter(l => l.startsWith('- '));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('First');
    expect(lines[1]).toContain('Second');
    expect(lines[2]).toContain('Third');
  });

  test('handles metadata without type but with tags', () => {
    const result = formatAutoRecallInjection([
      makeResult({
        content: 'Tagged memory',
        metadata: { tags: ['important', 'review'] },
      }),
    ]);
    expect(result).toMatch(/Tagged memory/);
  });

  test('global consistency: empty input vs one entry', () => {
    expect(formatAutoRecallInjection([])).toBe('');
    expect(formatAutoRecallInjection([makeResult()])).not.toBe('');
  });
});

// ============================================================================
// buildCaptureSnapshot
// ============================================================================
describe('buildCaptureSnapshot', () => {
  test('builds basic snapshot with feature info', () => {
    const result = buildCaptureSnapshot('my-feature', 'active', 3, 5);
    expect(result).toContain('my-feature');
    expect(result).toContain('(active)');
    expect(result).toContain('Tasks: 3/5 completed');
    expect(result).toMatch(/Captured: /);
  });

  test('includes pending tasks when provided', () => {
    const result = buildCaptureSnapshot('test', 'active', 1, 4, ['task-2', 'task-3']);
    expect(result).toContain('Pending: task-2, task-3');
  });

  test('omits pending section when empty array', () => {
    const result = buildCaptureSnapshot('test', 'active', 5, 5, []);
    expect(result).not.toMatch(/Pending:/);
  });

  test('omits pending section when undefined', () => {
    const result = buildCaptureSnapshot('test', 'active', 2, 3);
    expect(result).not.toMatch(/Pending:/);
  });

  test('handles 0 completed tasks', () => {
    const result = buildCaptureSnapshot('new-feature', 'planning', 0, 5);
    expect(result).toContain('Tasks: 0/5 completed');
    expect(result).toContain('Captured:');
  });

  test('handles all tasks completed', () => {
    const result = buildCaptureSnapshot('done-feature', 'completed', 10, 10);
    expect(result).toContain('Tasks: 10/10 completed');
  });

  test('includes valid ISO timestamp', () => {
    const result = buildCaptureSnapshot('f', 'active', 0, 1);
    const capturedMatch = result.match(/Captured: (.+)/);
    expect(capturedMatch).not.toBeNull();
    const date = new Date(capturedMatch![1]);
    expect(date.getTime()).not.toBeNaN();
  });

  test('multiple calls produce different timestamps', async () => {
    const r1 = buildCaptureSnapshot('f', 'active', 0, 1);
    await new Promise(r => setTimeout(r, 10));
    const r2 = buildCaptureSnapshot('f', 'active', 0, 1);
    const t1 = r1.match(/Captured: (.+)/)![1];
    const t2 = r2.match(/Captured: (.+)/)![1];
    expect(t1).not.toBe(t2);
  });
});
