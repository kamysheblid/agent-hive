import * as fs from 'node:fs';
import * as path from 'node:path';
import { tool, type ToolDefinition } from '@opencode-ai/plugin';

// ============================================================================
// BM25 Implementation (pure TypeScript, no external deps)
// ============================================================================

const STOPWORDS = new Set([
  // English stopwords
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with',
  'to', 'for', 'of', 'not', 'no', 'can', 'had', 'has', 'have', 'was', 'were',
  'be', 'been', 'being', 'do', 'does', 'did', 'it', 'its', 'this', 'that',
  'these', 'those', 'from', 'by', 'as', 'are', 'if', 'then', 'than', 'so',
  'just', 'about', 'above', 'after', 'again', 'all', 'also', 'any', 'because',
  'before', 'between', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'into', 'only', 'own', 'same', 'through', 'too', 'very',
  // Common code tokens (keep code keywords like function/const searchable)
  'console', 'log', 'error', 'warn', 'info', 'debug',
  'return', 'throw', 'new', 'typeof', 'instanceof',
  'void', 'null', 'undefined', 'true', 'false',
  'this', 'super', 'extends', 'implements',
  'get', 'set',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t));
}

export interface BM25Index {
  docCount: number;
  avgDocLength: number;
  terms: Map<string, Set<string>>; // term -> set of doc keys
  docFreqs: Map<string, number>;   // term -> document frequency
  docLengths: Map<string, number>; // doc key -> length
  docTfs: Map<string, Map<string, number>>; // doc key -> term -> tf
  docKeys: string[]; // ordered list of doc keys
}

export interface BM25Options {
  k1?: number;
  b?: number;
  limit?: number;
}

export function buildIndex(files: string[]): BM25Index {
  const terms = new Map<string, Set<string>>();
  const docFreqs = new Map<string, number>();
  const docLengths = new Map<string, number>();
  const docTfs = new Map<string, Map<string, number>>();
  const docKeys: string[] = [];

  let totalLength = 0;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue; // skip unreadable files
    }

    const tokens = tokenize(content);
    const tf = new Map<string, number>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    docKeys.push(file);
    docLengths.set(file, tokens.length);
    docTfs.set(file, tf);
    totalLength += tokens.length;

    const seenTerms = new Set<string>();
    for (const token of tokens) {
      if (seenTerms.has(token)) continue;
      seenTerms.add(token);

      if (!terms.has(token)) {
        terms.set(token, new Set());
      }
      terms.get(token)!.add(file);
      docFreqs.set(token, (docFreqs.get(token) ?? 0) + 1);
    }
  }

  return {
    docCount: files.length,
    avgDocLength: files.length > 0 ? totalLength / files.length : 0,
    terms,
    docFreqs,
    docLengths,
    docTfs,
    docKeys,
  };
}

export function bm25Search(
  query: string,
  index: BM25Index,
  options?: BM25Options,
): Array<{ file: string; line: number; score: number; snippet: string }> {
  const k1 = options?.k1 ?? 1.5;
  const b = options?.b ?? 0.75;
  const limit = options?.limit ?? 20;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scores = new Map<string, number>();

  for (const token of queryTokens) {
    const docsWithTerm = index.terms.get(token);
    if (!docsWithTerm) continue;

    const df = index.docFreqs.get(token) ?? 0;
    const idf = Math.log((index.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const doc of docsWithTerm) {
      const tf = index.docTfs.get(doc)?.get(token) ?? 0;
      const docLen = index.docLengths.get(doc) ?? 0;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLen / index.avgDocLength));
      const score = idf * (numerator / denominator);
      scores.set(doc, (scores.get(doc) ?? 0) + score);
    }
  }

  const sorted = Array.from(scores.entries())
    .map(([file, score]) => {
      const content = readFileSnippet(file);
      return { file, line: 1, score, snippet: content };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted;
}

function readFileSnippet(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, 200);
  } catch {
    return '';
  }
}

// ============================================================================
// AST Pattern Search (via @ast-grep/napi)
// ============================================================================

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  snippet: string;
  score: number;
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);

function getLangFromExt(ext: string): string | null {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
  };
  return map[ext] ?? null;
}

function walkCodeFiles(dir: string, maxFiles = 10000): string[] {
  const results: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

  function walk(currentDir: string, depth: number) {
    if (depth > 10 || results.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      if (skipDirs.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (CODE_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir, 0);
  return results;
}

let astGrepLang: typeof import('@ast-grep/napi').Lang | null = null;
let astGrepParse: typeof import('@ast-grep/napi').parse | null = null;

async function loadAstGrep() {
  if (astGrepLang) return true;
  try {
    const mod = await import('@ast-grep/napi');
    astGrepLang = mod.Lang;
    astGrepParse = mod.parse;
    return true;
  } catch {
    return false;
  }
}

const LANG_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
};

export async function astGrepSearch(
  pattern: string,
  lang: string,
  searchPath: string,
): Promise<SearchResult[]> {
  const loaded = await loadAstGrep();
  if (!loaded || !astGrepLang || !astGrepParse) return [];

  const files = walkCodeFiles(searchPath);
  const results: SearchResult[] = [];

  for (const file of files) {
    const ext = path.extname(file);
    const langName = LANG_MAP[ext] ?? lang;
    const langKey = langName as keyof typeof astGrepLang;

    const languageValue = astGrepLang[langKey];
    if (typeof languageValue !== 'string' && typeof languageValue !== 'number') continue;

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const ast = astGrepParse(languageValue as any, content);
      const root = ast.root();

      const matches = root.findAll(pattern);
      for (const match of matches) {
        const range = match.range();
        const startLine = range.start.line + 1;
        const startCol = range.start.column;
        const lines = content.split('\n');
        const snippet = lines[startLine - 1]?.trim().slice(0, 120) ?? '';

        results.push({
          file,
          line: startLine,
          column: startCol,
          snippet,
          score: 1.0,
        });
      }
    } catch {
      // skip files that fail to parse
    }
  }

  return results;
}

// ============================================================================
// Symbol Search (via dora CLI)
// ============================================================================

export async function doraSymbolSearch(name: string): Promise<{
  success: boolean;
  results: SearchResult[];
  hint?: string;
}> {
  try {
    const { execSync } = await import('child_process');
    const output = execSync(`dora symbol "${name}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10_000,
    });

    const lines = output.trim().split('\n').filter(l => l.length > 0);
    const results: SearchResult[] = [];

    for (const line of lines) {
      // dora output format: "path:line:col symbol kind"
      const match = line.match(/^(.+?):(\d+):(\d+)\s+(.+)$/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          snippet: match[4],
          score: 0.8,
        });
      }
    }

    return { success: true, results };
  } catch {
    return {
      success: false,
      results: [],
      hint: 'Install dora for symbol search: bun install -g @butttons/dora',
    };
  }
}

// ============================================================================
// Global Index State
// ============================================================================

let globalIndex: BM25Index | null = null;
let indexedPath: string | null = null;

function getPathToIndex(userPath?: string): string {
  return path.resolve(userPath ?? process.cwd());
}

export function buildSearchIndex(searchPath?: string): { filesIndexed: number; termCount: number } {
  const resolvedPath = getPathToIndex(searchPath);
  const files = walkCodeFiles(resolvedPath);
  globalIndex = buildIndex(files);
  indexedPath = resolvedPath;

  return {
    filesIndexed: files.length,
    termCount: globalIndex.terms.size,
  };
}

export function getIndexStatus(): { filesIndexed: number; termCount: number; indexedPath: string | null } {
  return {
    filesIndexed: globalIndex?.docCount ?? 0,
    termCount: globalIndex?.terms.size ?? 0,
    indexedPath,
  };
}

// ============================================================================
// Fusion
// ============================================================================

export function fuseResults(
  bm25Results: Array<{ file: string; line: number; score: number; snippet: string }>,
  astResults: Array<{ file: string; line: number; score: number; snippet: string }>,
  symbolResults: Array<{ file: string; line: number; score: number; snippet: string }>,
): Array<{ file: string; line: number; score: number; snippet: string; sources: string[] }> {
  const W_BM25 = 0.4;
  const W_AST = 0.3;
  const W_SYMBOL = 0.3;

  const normalized = new Map<string, { file: string; line: number; score: number; snippet: string; sources: string[] }>();

  function normalizeAndAdd(
    results: Array<{ file: string; line: number; score: number; snippet: string }>,
    weight: number,
    source: string,
  ) {
    if (results.length === 0) return;
    const maxScore = Math.max(...results.map(r => r.score), 1);

    for (const r of results) {
      const key = `${r.file}:${r.line}`;
      const existing = normalized.get(key);
      const normalizedScore = (r.score / maxScore) * weight;

      if (existing) {
        existing.score += normalizedScore;
        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
      } else {
        normalized.set(key, {
          file: r.file,
          line: r.line,
          score: normalizedScore,
          snippet: r.snippet,
          sources: [source],
        });
      }
    }
  }

  normalizeAndAdd(bm25Results, W_BM25, 'bm25');
  normalizeAndAdd(astResults, W_AST, 'ast');
  normalizeAndAdd(symbolResults, W_SYMBOL, 'symbol');

  return Array.from(normalized.values())
    .sort((a, b) => b.score - a.score);
}

// ============================================================================
// Unified Search
// ============================================================================

export async function runCodeSearch(
  query: string,
  searchPath?: string,
  limit?: number,
): Promise<{
  success: boolean;
  results: Array<{ file: string; line: number; score: number; snippet: string; sources: string[] }>;
  meta: { bm25Count: number; astCount: number; symbolCount: number; totalFused: number };
}> {
  const resolvedPath = getPathToIndex(searchPath);

  // Build index if not cached or path changed
  if (!globalIndex || indexedPath !== resolvedPath) {
    buildSearchIndex(resolvedPath);
  }

  const bm25Results = bm25Search(query, globalIndex!, { limit: limit ?? 20 });
  const astResults = await astGrepSearch(query, 'typescript', resolvedPath).catch(() => []);
  const symbolResults = await doraSymbolSearch(query).then(r => r.results).catch(() => []);

  const fused = fuseResults(bm25Results, astResults, symbolResults);

  const limited = limit ? fused.slice(0, limit) : fused;

  return {
    success: true,
    results: limited,
    meta: {
      bm25Count: bm25Results.length,
      astCount: astResults.length,
      symbolCount: symbolResults.length,
      totalFused: limited.length,
    },
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const codeSearchTool: ToolDefinition = tool({
  description: `Search code using BM25 keyword + AST pattern + symbol fusion.

**Parameters:**
- query: Search query (keywords or AST pattern)
- path: Directory to search (defaults to current directory)
- limit: Maximum results (default: 20)

**Search strategies:**
1. **BM25** — Keyword relevance ranking
2. **AST pattern** — Structural code matching via @ast-grep/napi
3. **Symbol** — SCIP-based symbol search via dora (optional)

Results are deduplicated and ranked by combined score across all strategies.

**Example:**
\`\`\`
code_search({ query: "function authenticate", path: "./src" })
\`\`\``,

  args: {
    query: tool.schema.string().describe('Search query (keywords or AST pattern)'),
    path: tool.schema.string().optional().describe('Directory to search (defaults to cwd)'),
    limit: tool.schema.number().optional().default(20).describe('Maximum results'),
  },

  async execute({ query, path: searchPath, limit }) {
    try {
      const result = await runCodeSearch(query, searchPath, limit);
      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});

export const codeSearchIndexTool: ToolDefinition = tool({
  description: `Build or rebuild the BM25 search index.

**Parameters:**
- path: Directory to index (defaults to current directory)

**Example:**
\`\`\`
code_search_index({ path: "./src" })
\`\`\`

Returns the number of files indexed and unique terms found.`,

  args: {
    path: tool.schema.string().optional().describe('Directory to index (defaults to cwd)'),
  },

  async execute({ path: searchPath }) {
    try {
      const result = buildSearchIndex(searchPath);
      return JSON.stringify({
        success: true,
        filesIndexed: result.filesIndexed,
        termCount: result.termCount,
        path: searchPath ?? process.cwd(),
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});

export const codeSearchStatusTool: ToolDefinition = tool({
  description: `Check BM25 search index status.

Returns the number of files indexed, unique terms, and the indexed path.`,

  args: {},

  async execute() {
    const status = getIndexStatus();
    return JSON.stringify({
      success: true,
      ...status,
      ready: status.filesIndexed > 0,
    }, null, 2);
  },
});
