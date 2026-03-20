import { describe, test, expect, beforeEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent Booster Tools', () => {
  const testDir = '/tmp/hive-agent-booster-test';
  
  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });
  
  describe('applyCodeEdit', () => {
    test('should apply simple edit', async () => {
      const testFile = path.join(testDir, 'test.ts');
      fs.writeFileSync(testFile, 'const old = "value";\n', 'utf-8');
      
      // Since agent-booster may not be installed, this will use fallback
      const { applyCodeEdit } = await import('../tools/agent-booster.js');
      
      const result = await applyCodeEdit({
        path: testFile,
        oldContent: 'const old = "value";',
        newContent: 'const new = "updated";',
      });
      
      expect(result.success).toBe(true);
      
      const content = fs.readFileSync(testFile, 'utf-8');
      expect(content).toBe('const new = "updated";\n');
    });
    
    test('should handle file not found', async () => {
      const { applyCodeEdit } = await import('../tools/agent-booster.js');
      
      const result = await applyCodeEdit({
        path: '/nonexistent/file.ts',
        oldContent: 'test',
        newContent: 'replacement',
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
    
    test('should handle content not found', async () => {
      const testFile = path.join(testDir, 'test.ts');
      fs.writeFileSync(testFile, 'const original = "content";\n', 'utf-8');
      
      const { applyCodeEdit } = await import('../tools/agent-booster.js');
      
      const result = await applyCodeEdit({
        path: testFile,
        oldContent: 'nonexistent content',
        newContent: 'replacement',
      });
      
      expect(result.success).toBe(false);
    });
  });
  
  describe('isBoosterAvailable', () => {
    test('should return boolean', async () => {
      const { isBoosterAvailable } = await import('../tools/agent-booster.js');
      const available = await isBoosterAvailable();
      expect(typeof available).toBe('boolean');
    });
  });
  
  describe('getBoosterStatus', () => {
    test('should return status object', async () => {
      const { getBoosterStatus } = await import('../tools/agent-booster.js');
      const status = await getBoosterStatus();
      
      expect(status).toHaveProperty('available');
      expect(typeof status.available).toBe('boolean');
    });
  });
});
