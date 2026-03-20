import { describe, test, expect, beforeAll } from 'bun:test';
import { 
  isAstGrepAvailable, 
  getAstGrepStatus 
} from './ast-grep-native';

describe('ast-grep-native', () => {
  describe('isAstGrepAvailable', () => {
    test('should check availability', async () => {
      const available = await isAstGrepAvailable();
      // Should be true if @ast-grep/napi is installed
      expect(typeof available).toBe('boolean');
    });
  });

  describe('getAstGrepStatus', () => {
    test('should return status object', async () => {
      const status = await getAstGrepStatus();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('version');
    });

    test('should indicate availability correctly', async () => {
      const status = await getAstGrepStatus();
      const available = await isAstGrepAvailable();
      expect(status.available).toBe(available);
    });
  });
});

describe('ast-grep native tools', () => {
  test('should have lazy initialization', async () => {
    // Module should be lazily loaded
    const { isAstGrepAvailable: check } = await import('./ast-grep-native');
    const result = await check();
    expect(typeof result).toBe('boolean');
  });
});
