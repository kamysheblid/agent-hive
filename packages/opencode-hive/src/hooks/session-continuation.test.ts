import { describe, it, expect } from 'bun:test';
import { createContinuationState, buildContinuationContext } from './session-continuation.js';

describe('ContinuationState', () => {
  it('starts not injected', () => {
    const state = createContinuationState();
    expect(state.injected).toBe(false);
  });

  it('tracks injection state', () => {
    const state = createContinuationState();
    state.markInjected();
    expect(state.injected).toBe(true);
    state.reset();
    expect(state.injected).toBe(false);
  });
});

describe('buildContinuationContext', () => {
  it('returns null for empty pending', () => {
    expect(buildContinuationContext('test', [], null)).toBeNull();
  });

  it('builds context with pending tasks', () => {
    const result = buildContinuationContext(
      'test',
      [{ folder: '01-task', name: 'Task 1', status: 'pending' }],
      { folder: '01-task', name: 'Task 1', status: 'pending' },
    );
    expect(result).toContain('Task 1');
    expect(result).toContain('Remaining Tasks (1)');
    expect(result).toContain('Continue working');
  });

  it('includes in_progress marker', () => {
    const result = buildContinuationContext(
      'test',
      [
        { folder: '01-a', name: 'Task A', status: 'in_progress' },
        { folder: '02-b', name: 'Task B', status: 'pending' },
      ],
      { folder: '01-a', name: 'Task A', status: 'in_progress' },
    );
    expect(result).toContain('[~]');
    expect(result).toContain('[ ]');
    expect(result).toContain('Next Task');
  });
});
