import { describe, test, expect } from 'bun:test';
import { 
  isAstGrepAvailable, 
  getAstGrepStatus 
} from './ast-grep-native';

describe('ast-grep-native', () => {
  describe('isAstGrepAvailable', () => {
    test('should check availability without blocking', async () => {
      const available = await isAstGrepAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('getAstGrepStatus', () => {
    test('should return status object with mode', async () => {
      const status = await getAstGrepStatus();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('mode');
      expect(['native', 'cli', 'unavailable']).toContain(status.mode);
    }, 10000);
  });
});
