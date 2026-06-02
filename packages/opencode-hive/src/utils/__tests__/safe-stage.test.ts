import { describe, it, expect, vi } from 'bun:test';
import { safeStage, safeStageAsync, safeHook, conservativeFilter } from '../safe-stage.js';

describe('safeStage', () => {
  it('should return result when fn succeeds', () => {
    const result = safeStage('test', () => 42, 0);
    expect(result).toBe(42);
  });

  it('should return fallback when fn throws', () => {
    const result = safeStage('test', () => { throw new Error('fail'); }, 'fallback');
    expect(result).toBe('fallback');
  });

  it('should return fallback when fn throws non-Error', () => {
    const result = safeStage('test', () => { throw 'string error'; }, false);
    expect(result).toBe(false);
  });

  it('should preserve null/undefined results', () => {
    const nullResult = safeStage('test', () => null, 'fallback');
    expect(nullResult).toBeNull();

    const undefResult = safeStage('test', () => undefined, 'fallback');
    expect(undefResult).toBeUndefined();
  });

  it('should apply conservative filter for oversized string output', () => {
    const result = safeStage('test', () => 'x'.repeat(100), 'short');
    // 100 > 5 * 3 = 15, so fallback
    expect(result).toBe('short');
  });

  it('should NOT filter when fallback is empty', () => {
    const result = safeStage('test', () => 'big output', '');
    expect(result).toBe('big output');
  });

  it('should NOT filter non-string types', () => {
    const fn = () => ({ data: [1, 2, 3] });
    const result = safeStage('test', fn, {});
    expect(result).toEqual({ data: [1, 2, 3] });
  });
});

describe('safeStageAsync', () => {
  it('should return result when async fn succeeds', async () => {
    const result = await safeStageAsync('test', async () => 'success', 'fallback');
    expect(result).toBe('success');
  });

  it('should return fallback when async fn rejects', async () => {
    const result = await safeStageAsync('test', async () => { throw new Error('async fail'); }, 0);
    expect(result).toBe(0);
  });

  it('should apply conservative filter for oversized string', async () => {
    const result = await safeStageAsync('test', async () => 'x'.repeat(50), 'small');
    expect(result).toBe('small');
  });

  it('should handle promise rejection without Error', async () => {
    const result = await safeStageAsync('test', async () => { throw 'just a string'; }, null);
    expect(result).toBeNull();
  });
});

describe('safeHook', () => {
  it('should invoke handler and not throw on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = safeHook('test', handler);

    await wrapped({}, {});
    expect(handler).toHaveBeenCalledWith({}, {});
  });

  it('should catch errors from handler without throwing', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('hook failed'));
    const wrapped = safeHook('test', handler);

    // Should not throw
    await wrapped({}, {});
    expect(handler).toHaveBeenCalled();
  });

  it('should catch synchronous throws from handler', async () => {
    const handler = vi.fn().mockImplementation(() => { throw new Error('sync fail'); });
    const wrapped = safeHook('test', handler);

    await wrapped({}, {});
    expect(handler).toHaveBeenCalled();
  });

  it('should handle multiple calls safely', async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      if (callCount === 2) throw new Error('second call fails');
    };
    const wrapped = safeHook('multi', handler);

    await wrapped({}, {});
    await wrapped({}, {}); // This one throws but wrapped should catch it
    await wrapped({}, {});

    expect(callCount).toBe(3);
  });
});

describe('conservativeFilter', () => {
  it('should return result when within size limit', () => {
    expect(conservativeFilter('short', 'still short', 3)).toBe('still short');
  });

  it('should return original when result exceeds limit', () => {
    expect(conservativeFilter('short', 'x'.repeat(20), 3)).toBe('short');
  });

  it('should not filter when original is empty', () => {
    expect(conservativeFilter('', 'anything', 3)).toBe('anything');
  });

  it('should use custom maxFactor', () => {
    expect(conservativeFilter('base', 'x'.repeat(10), 2)).toBe('base'); // 10 > 4*2
    expect(conservativeFilter('base', 'x'.repeat(5), 2)).toBe('x'.repeat(5)); // 5 <= 4*2
  });
});
