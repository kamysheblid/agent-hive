import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const testDir = '/tmp/hive-call-graph-test';

function setupTestDir(structure: Record<string, string | null>) {
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(testDir, filePath);
    if (content === null) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }
}

// Import implementation functions directly
// We test the internal logic by importing the module
async function getModule() {
  return await import('./call-graph.js');
}

describe('call-graph', () => {
  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // =========================================================================
  // extractCalls tests
  // =========================================================================

  describe('extractCalls', () => {
    test('extracts function calls from a file', async () => {
      setupTestDir({
        'app.ts': [
          'function greet(name: string) {',
          '  console.log(name);',
          '}',
          'greet("world");',
        ].join('\n'),
      });

      const { extractCalls } = await getModule();
      const calls = extractCalls(path.join(testDir, 'app.ts'));

      expect(calls.length).toBeGreaterThanOrEqual(2);
      // Should find console.log and greet calls
      const callees = calls.map(c => c.callee);
      expect(callees).toContain('console.log');
      expect(callees).toContain('greet');
    });

    test('extracts method calls ($OBJ.$NAME)', async () => {
      setupTestDir({
        'app.ts': [
          'const arr = [1, 2, 3];',
          'arr.push(4);',
          'arr.map(x => x * 2);',
        ].join('\n'),
      });

      const { extractCalls } = await getModule();
      const calls = extractCalls(path.join(testDir, 'app.ts'));

      const callees = calls.map(c => c.callee);
      expect(callees).toContain('arr.push');
      expect(callees).toContain('arr.map');
    });

    test('extracts constructor calls (new $NAME)', async () => {
      setupTestDir({
        'app.ts': [
          'class Foo {}',
          'const foo = new Foo();',
        ].join('\n'),
      });

      const { extractCalls } = await getModule();
      const calls = extractCalls(path.join(testDir, 'app.ts'));

      const callees = calls.map(c => c.callee);
      expect(callees).toContain('new Foo');
    });

    test('extracts require calls', async () => {
      setupTestDir({
        'app.js': [
          "const fs = require('fs');",
          "const path = require('path');",
        ].join('\n'),
      });

      const { extractCalls } = await getModule();
      const calls = extractCalls(path.join(testDir, 'app.js'));

      const callees = calls.map(c => c.callee);
      expect(callees).toContain('require');
    });

    test('returns empty array for file with no calls', async () => {
      setupTestDir({
        'empty.ts': 'const x = 42;\nconst y = "hello";',
      });

      const { extractCalls } = await getModule();
      const calls = extractCalls(path.join(testDir, 'empty.ts'));

      expect(calls).toEqual([]);
    });

    test('returns empty array for nonexistent file', async () => {
      const { extractCalls } = await getModule();
      const calls = extractCalls('/nonexistent/file.ts');

      expect(calls).toEqual([]);
    });

    test('each call has required fields', async () => {
      setupTestDir({
        'app.ts': 'function foo() {}\nfoo();',
      });

      const { extractCalls } = await getModule();
      const calls = extractCalls(path.join(testDir, 'app.ts'));

      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const call of calls) {
        expect(call).toHaveProperty('callee');
        expect(call).toHaveProperty('caller');
        expect(call).toHaveProperty('line');
        expect(call).toHaveProperty('type');
        expect(typeof call.callee).toBe('string');
        expect(typeof call.line).toBe('number');
        expect(['call', 'method', 'constructor', 'require', 'import']).toContain(call.type);
      }
    });
  });

  // =========================================================================
  // buildCallGraph tests
  // =========================================================================

  describe('buildCallGraph', () => {
    test('builds graph from a directory of files', async () => {
      setupTestDir({
        'utils.ts': [
          'export function helper() { console.log("helper"); }',
        ].join('\n'),
        'app.ts': [
          'import { helper } from "./utils";',
          'function main() {',
          '  helper();',
          '}',
          'main();',
        ].join('\n'),
      });

      const { buildCallGraph } = await getModule();
      const graph = buildCallGraph(testDir);

      expect(graph.symbols.size).toBeGreaterThan(0);
    });

    test('skips node_modules directory', async () => {
      setupTestDir({
        'src/app.ts': 'function main() { helper(); }',
        'node_modules/dep/index.ts': 'export function dep() {}',
      });

      const { buildCallGraph } = await getModule();
      const graph = buildCallGraph(testDir);

      // Should not have any symbols from node_modules
      const symbols = Array.from(graph.symbols.keys());
      for (const sym of symbols) {
        expect(sym).not.toContain('dep');
      }
    });

    test('handles empty directory', async () => {
      const { buildCallGraph } = await getModule();
      const graph = buildCallGraph(testDir);

      expect(graph.symbols.size).toBe(0);
    });
  });

  // =========================================================================
  // getCallees tests
  // =========================================================================

  describe('getCallees', () => {
    test('returns callees for a known function', async () => {
      setupTestDir({
        'app.ts': [
          'function helper() { console.log("done"); }',
          'function main() {',
          '  helper();',
          '  console.log("main");',
          '}',
        ].join('\n'),
      });

      const { getCallees } = await getModule();
      const callees = getCallees('main', testDir);

      expect(callees.length).toBeGreaterThanOrEqual(1);
      const names = callees.map(c => c.name);
      expect(names).toContain('helper');
      expect(names).toContain('console.log');
    });

    test('returns empty for unknown function', async () => {
      setupTestDir({
        'app.ts': 'function main() { console.log("hi"); }',
      });

      const { getCallees } = await getModule();
      const callees = getCallees('nonexistent', testDir);

      expect(callees).toEqual([]);
    });
  });

  // =========================================================================
  // getCallers tests
  // =========================================================================

  describe('getCallers', () => {
    test('returns callers for a known function', async () => {
      setupTestDir({
        'app.ts': [
          'function helper() { console.log("done"); }',
          'function main() {',
          '  helper();',
          '}',
          'function init() {',
          '  helper();',
          '  main();',
          '}',
        ].join('\n'),
      });

      const { getCallers } = await getModule();
      const callers = getCallers('helper', testDir);

      expect(callers.length).toBeGreaterThanOrEqual(1);
      const names = callers.map(c => c.name);
      expect(names).toContain('main');
      expect(names).toContain('init');
    });

    test('returns empty for uncalled function', async () => {
      setupTestDir({
        'app.ts': [
          'function standalone() { console.log("alone"); }',
          'function main() { console.log("main"); }',
        ].join('\n'),
      });

      const { getCallers } = await getModule();
      const callers = getCallers('standalone', testDir);

      expect(callers).toEqual([]);
    });
  });

  // =========================================================================
  // getCallPath tests
  // =========================================================================

  describe('getCallPath', () => {
    test('finds direct call path', async () => {
      setupTestDir({
        'app.ts': [
          'function a() { b(); }',
          'function b() { c(); }',
          'function c() { console.log("end"); }',
        ].join('\n'),
      });

      const { getCallPath } = await getModule();
      const callPath = getCallPath('a', 'c', testDir);

      // Should find a path: a -> b -> c
      expect(callPath).not.toBeNull();
      if (callPath) {
        expect(callPath.length).toBeGreaterThanOrEqual(2);
        expect(callPath[0]).toBe('a');
        expect(callPath[callPath.length - 1]).toBe('c');
      }
    });

    test('returns null when no path exists', async () => {
      setupTestDir({
        'app.ts': [
          'function a() { console.log("a"); }',
          'function b() { console.log("b"); }',
        ].join('\n'),
      });

      const { getCallPath } = await getModule();
      const callPath = getCallPath('a', 'b', testDir);

      expect(callPath).toBeNull();
    });

    test('returns null for unknown start symbol', async () => {
      setupTestDir({
        'app.ts': 'function a() { console.log("a"); }',
      });

      const { getCallPath } = await getModule();
      const callPath = getCallPath('nonexistent', 'a', testDir);

      expect(callPath).toBeNull();
    });
  });

  // =========================================================================
  // Tool registration tests (tool shapes)
  // =========================================================================

  describe('tool definitions', () => {
    test('exports all 4 tool definitions', async () => {
      const mod = await getModule();
      expect(mod.callGraphCalleesTool).toBeDefined();
      expect(mod.callGraphCallersTool).toBeDefined();
      expect(mod.callGraphPathTool).toBeDefined();
      expect(mod.callGraphExtractTool).toBeDefined();
    });
  });
});
