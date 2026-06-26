import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const testDir = '/tmp/hive-code-search-test';

function setupTestDir(structure: Record<string, string>) {
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(testDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

describe('BM25 search', () => {
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

  test('tokenize: splits text into lowercase tokens', async () => {
    const { tokenize } = await import('./code-search.js');
    const tokens = tokenize('Hello World 123');
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
    expect(tokens).toContain('123');
  });

  test('tokenize: removes stopwords', async () => {
    const { tokenize } = await import('./code-search.js');
    const tokens = tokenize('the function is const');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).toContain('function');
    expect(tokens).toContain('const');
  });

  test('buildIndex: builds term frequency index from files', async () => {
    setupTestDir({
      'file1.ts': 'function hello() { return "hello world"; }',
      'file2.ts': 'function goodbye() { return "goodbye world"; }',
    });

    const { buildIndex } = await import('./code-search.js');
    const files = [
      path.join(testDir, 'file1.ts'),
      path.join(testDir, 'file2.ts'),
    ];
    const index = buildIndex(files);

    expect(index.docCount).toBe(2);
    expect(index.avgDocLength).toBeGreaterThan(0);
    expect(index.terms.size).toBeGreaterThan(0);
  });

  test('bm25Search: finds matching files ranked by relevance', async () => {
    setupTestDir({
      'auth.ts': 'function authenticate() { return true; }',
      'utils.ts': 'function utility() { return "helper"; }',
      'main.ts': 'function main() { return authenticate(); }',
    });

    const { buildIndex, bm25Search } = await import('./code-search.js');
    const files = [
      path.join(testDir, 'auth.ts'),
      path.join(testDir, 'utils.ts'),
      path.join(testDir, 'main.ts'),
    ];
    const index = buildIndex(files);
    const results = bm25Search('authenticate', index);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe(path.join(testDir, 'auth.ts'));
    expect(results[0].score).toBeGreaterThan(0);
  });

  test('bm25Search: returns empty for no matches', async () => {
    setupTestDir({
      'simple.ts': 'const x = 1;',
    });

    const { buildIndex, bm25Search } = await import('./code-search.js');
    const files = [path.join(testDir, 'simple.ts')];
    const index = buildIndex(files);
    const results = bm25Search('zzzznonexistent', index);

    expect(results.length).toBe(0);
  });

  test('bm25Search: limits results', async () => {
    setupTestDir({
      'a.ts': 'const alpha = 1;',
      'b.ts': 'const alpha = 2;',
      'c.ts': 'const alpha = 3;',
      'd.ts': 'const alpha = 4;',
      'e.ts': 'const alpha = 5;',
    });

    const { buildIndex, bm25Search } = await import('./code-search.js');
    const files = [
      path.join(testDir, 'a.ts'),
      path.join(testDir, 'b.ts'),
      path.join(testDir, 'c.ts'),
      path.join(testDir, 'd.ts'),
      path.join(testDir, 'e.ts'),
    ];
    const index = buildIndex(files);
    const results = bm25Search('alpha', index, { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });
});

describe('AST pattern search', () => {
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

  test('astGrepSearch: finds function declarations by pattern', async () => {
    setupTestDir({
      'funcs.ts': [
        'function hello() { return "hello"; }',
        'function world() { return "world"; }',
        'const x = 1;',
      ].join('\n'),
    });

    const { astGrepSearch } = await import('./code-search.js');
    const results = await astGrepSearch('function $NAME($$$) { $$$ }', 'typescript', testDir);

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].file).toBeDefined();
    expect(results[0].line).toBeGreaterThan(0);
  });

  test('astGrepSearch: returns empty for no matches', async () => {
    setupTestDir({
      'simple.ts': 'const x = 1;',
    });

    const { astGrepSearch } = await import('./code-search.js');
    const results = await astGrepSearch('class $NAME { $$$ }', 'typescript', testDir);

    expect(results.length).toBe(0);
  });
});

describe('Symbol search (via dora)', () => {
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

  test('doraSymbolSearch: returns empty with hint when dora not installed', async () => {
    const { doraSymbolSearch } = await import('./code-search.js');
    const result = await doraSymbolSearch('myFunction');

    // dora may or may not be installed, but result should always have this shape
    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
    if (!result.success) {
      expect(result.hint).toBeDefined();
    }
  });
});

describe('Fusion search', () => {
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

  test('fuseResults: deduplicates by file:line', async () => {
    const { fuseResults } = await import('./code-search.js');

    const bm25Results = [
      { file: '/a.ts', line: 1, score: 0.5, snippet: 'hello' },
      { file: '/b.ts', line: 2, score: 0.3, snippet: 'world' },
    ];
    const astResults = [
      { file: '/a.ts', line: 1, score: 0.8, snippet: 'hello' },
      { file: '/c.ts', line: 3, score: 0.6, snippet: 'foo' },
    ];
    const symbolResults = [
      { file: '/a.ts', line: 1, score: 0.9, snippet: 'hello' },
    ];

    const fused = fuseResults(bm25Results, astResults, symbolResults);

    // /a.ts:1 appears in all three — should be deduplicated to 1 entry
    const aLine1 = fused.filter(r => r.file === '/a.ts' && r.line === 1);
    expect(aLine1.length).toBe(1);
    // Combined score should be weighted sum
    expect(aLine1[0].score).toBeGreaterThan(0);
    // All unique entries should be present
    expect(fused.length).toBe(3);
  });

  test('fuseResults: sorts by combined score descending', async () => {
    const { fuseResults } = await import('./code-search.js');

    const bm25Results = [
      { file: '/a.ts', line: 1, score: 0.1, snippet: 'low' },
      { file: '/b.ts', line: 2, score: 0.9, snippet: 'high' },
    ];
    const astResults: any[] = [];
    const symbolResults: any[] = [];

    const fused = fuseResults(bm25Results, astResults, symbolResults);

    expect(fused[0].score).toBeGreaterThanOrEqual(fused[1].score);
  });
});

describe('Status', () => {
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

  test('getIndexStatus: returns index stats', async () => {
    const { getIndexStatus } = await import('./code-search.js');
    const status = getIndexStatus();

    expect(status).toHaveProperty('filesIndexed');
    expect(status).toHaveProperty('termCount');
    expect(status.filesIndexed).toBeGreaterThanOrEqual(0);
    expect(status.termCount).toBeGreaterThanOrEqual(0);
  });
});
