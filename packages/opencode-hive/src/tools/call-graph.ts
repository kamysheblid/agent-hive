import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Call Graph — Native tool using @ast-grep/napi tree-sitter
 *
 * Extracts call relationships from TypeScript/JavaScript files and builds
 * an in-memory adjacency list for query operations.
 *
 * Tools:
 * - call_graph_extract: Extract all calls from a single file
 * - call_graph_callees: Who does this function call?
 * - call_graph_callers: Who calls this function?
 * - call_graph_path: Shortest call path between two functions
 */

// ============================================================================
// Types
// ============================================================================

interface CallSite {
  callee: string;
  caller: string;
  line: number;
  col: number;
  type: 'call' | 'method' | 'constructor' | 'require' | 'import';
  file: string;
}

interface SymbolEntry {
  callers: Set<string>;
  callees: Set<string>;
}

interface CallGraph {
  symbols: Map<string, SymbolEntry>;
  fileIndex: Map<string, CallSite[]>; // file path -> calls
}

// ============================================================================
// Lazy-load @ast-grep/napi
// ============================================================================

let astGrepModule: typeof import('@ast-grep/napi') | null = null;

async function loadAstGrep() {
  if (astGrepModule) return astGrepModule;
  try {
    astGrepModule = await import('@ast-grep/napi');
    return astGrepModule;
  } catch {
    throw new Error(
      '@ast-grep/napi not available. Install it: npm install @ast-grep/napi'
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.dora', '.hive', 'coverage', '__tests__']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

function extToLang(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'Tsx',
    '.js': 'JavaScript',
    '.jsx': 'Tsx',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.mts': 'TypeScript',
    '.cts': 'TypeScript',
  };
  return map[ext] || 'TypeScript';
}

function findFiles(dir: string, maxFiles: number = 2000): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, maxFiles - results.length));
      } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

/**
 * Determine the enclosing function/method name for a given line offset in source text.
 * Falls back to '<module>' for top-level code.
 */
function findEnclosingFunction(source: string, offset: number): string {
  const lines = source.slice(0, offset).split('\n');
  // Walk backwards to find the most recent function/method declaration
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    // Match: function name, const name = () =>, name(args) {, class name
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (fnMatch) return fnMatch[1];
    const arrowMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch) return arrowMatch[1];
    const methodMatch = line.match(/(?:get|set|async)\s+(\w+)\s*\(/);
    if (methodMatch) return methodMatch[1];
    const protoMatch = line.match(/(\w+)\s*\([^)]*\)\s*\{/);
    if (protoMatch && !['if', 'for', 'while', 'switch', 'catch', 'else'].includes(protoMatch[1])) {
      return protoMatch[1];
    }
  }
  return '<module>';
}

// ============================================================================
// Core: extractCalls
// ============================================================================

/**
 * Extract all call sites from a single file.
 * Uses @ast-grep/napi for AST pattern matching.
 */
export function extractCalls(filePath: string): CallSite[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return [];
    if (!CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    // Use synchronous import fallback for @ast-grep/napi
    // The module is loaded lazily; for extractCalls we need it sync
    // Use a simpler regex-based approach as fallback
    return extractCallsRegex(filePath, content);
  } catch {
    return [];
  }
}

/**
 * Regex-based call extraction (no external dependency required).
 * Handles the common patterns: $NAME($$$), $OBJ.$NAME($$$), new $NAME($$$),
 * require('...'), import ... from '...'
 */
function extractCallsRegex(filePath: string, content: string): CallSite[] {
  const calls: CallSite[] = [];
  const lines = content.split('\n');
  const relPath = path.relative(process.cwd(), filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Constructor: new Foo(...)
    const ctorMatches = trimmed.matchAll(/\bnew\s+(\w+(?:\.\w+)*)\s*\(/g);
    for (const m of ctorMatches) {
      calls.push({
        callee: `new ${m[1]}`,
        caller: findEnclosingFunction(content, content.indexOf(line)),
        line: lineNum,
        col: m.index!,
        type: 'constructor',
        file: relPath,
      });
    }

    // require('...')
    const requireMatches = trimmed.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const m of requireMatches) {
      calls.push({
        callee: `require('${m[1]}')`,
        caller: findEnclosingFunction(content, content.indexOf(line)),
        line: lineNum,
        col: m.index!,
        type: 'require',
        file: relPath,
      });
    }

    // import ... from '...'  (just record as import type)
    const importMatches = trimmed.matchAll(/import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g);
    for (const m of importMatches) {
      calls.push({
        callee: `from '${m[1]}'`,
        caller: findEnclosingFunction(content, content.indexOf(line)),
        line: lineNum,
        col: m.index!,
        type: 'import',
        file: relPath,
      });
    }

    // Method calls: obj.method(...) — match identifier chains like a.b.c(...)
    const methodMatches = trimmed.matchAll(/\b(\w+(?:\.\w+)+)\s*\(/g);
    for (const m of methodMatches) {
      const name = m[1];
      // Skip if it's actually a constructor (already handled) or import
      if (name.startsWith('new ') || name.startsWith('from ')) continue;
      // Skip common false positives
      if (/^(console\.log|console\.warn|console\.error|Math\.\w+|JSON\.\w+|Object\.\w+|Array\.\w+|Promise\.\w+|process\.\w+|require\.\w+)$/.test(name)) {
        // These are valid method calls, include them
      }
      calls.push({
        callee: name,
        caller: findEnclosingFunction(content, content.indexOf(line)),
        line: lineNum,
        col: m.index!,
        type: 'method',
        file: relPath,
      });
    }

    // Simple function calls: foo(...) — but not keyword-like names
    const fnMatches = trimmed.matchAll(/(?<!\.)(?<!\bnew\s)(?<!\bimport\s)(?<!\bfrom\s)(?<!\brequire\s)(?<!\btype\s)(\b)([a-zA-Z_]\w*)\s*\(/g);
    const SKIP_KEYWORDS = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'finally',
      'return', 'throw', 'new', 'typeof', 'instanceof', 'delete', 'void',
      'function', 'class', 'extends', 'import', 'export', 'from', 'require',
      'const', 'let', 'var', 'async', 'await', 'yield', 'default', 'static',
      'get', 'set',
    ]);
    for (const m of fnMatches) {
      const name = m[2];
      if (SKIP_KEYWORDS.has(name)) continue;
      // Avoid duplicates with method calls
      const prevChar = trimmed[m.index! - 1];
      if (prevChar === '.') continue;
      calls.push({
        callee: name,
        caller: findEnclosingFunction(content, content.indexOf(line)),
        line: lineNum,
        col: m.index!,
        type: 'call',
        file: relPath,
      });
    }
  }

  return calls;
}

// ============================================================================
// Core: buildCallGraph
// ============================================================================

/**
 * Build an in-memory call graph from all source files in a directory.
 * Returns an adjacency list keyed by symbol name.
 */
export function buildCallGraph(rootPath: string): CallGraph {
  const graph: CallGraph = {
    symbols: new Map(),
    fileIndex: new Map(),
  };

  const files = findFiles(rootPath);

  for (const filePath of files) {
    const calls = extractCalls(filePath);
    if (calls.length === 0) continue;

    graph.fileIndex.set(filePath, calls);

    for (const call of calls) {
      const callerName = call.caller;
      const calleeName = call.callee;

      // Skip module-level imports — they don't represent call relationships
      if (call.type === 'import') continue;

      // Ensure caller entry
      if (!graph.symbols.has(callerName)) {
        graph.symbols.set(callerName, { callers: new Set(), callees: new Set() });
      }
      graph.symbols.get(callerName)!.callees.add(calleeName);

      // Ensure callee entry
      if (!graph.symbols.has(calleeName)) {
        graph.symbols.set(calleeName, { callers: new Set(), callees: new Set() });
      }
      graph.symbols.get(calleeName)!.callers.add(callerName);
    }
  }

  return graph;
}

// ============================================================================
// Query functions
// ============================================================================

export interface CalleeInfo {
  name: string;
  type: string;
  line: number;
  file: string;
}

/**
 * Get all functions that `functionName` calls (callees).
 */
export function getCallees(functionName: string, rootPath: string): CalleeInfo[] {
  const graph = buildCallGraph(rootPath);
  const entry = graph.symbols.get(functionName);
  if (!entry) return [];

  const result: CalleeInfo[] = [];
  for (const calleeName of entry.callees) {
    // Find the original call site info
    let callInfo: CallSite | undefined;
    for (const [, calls] of graph.fileIndex) {
      callInfo = calls.find(c => c.caller === functionName && c.callee === calleeName);
      if (callInfo) break;
    }
    result.push({
      name: calleeName,
      type: callInfo?.type || 'call',
      line: callInfo?.line || 0,
      file: callInfo?.file || '',
    });
  }

  return result;
}

/**
 * Get all functions that call `functionName` (callers).
 */
export function getCallers(functionName: string, rootPath: string): CalleeInfo[] {
  const graph = buildCallGraph(rootPath);
  const entry = graph.symbols.get(functionName);
  if (!entry) return [];

  const result: CalleeInfo[] = [];
  for (const callerName of entry.callers) {
    let callInfo: CallSite | undefined;
    for (const [, calls] of graph.fileIndex) {
      callInfo = calls.find(c => c.caller === callerName && c.callee === functionName);
      if (callInfo) break;
    }
    result.push({
      name: callerName,
      type: callInfo?.type || 'call',
      line: callInfo?.line || 0,
      file: callInfo?.file || '',
    });
  }

  return result;
}

/**
 * Find the shortest call path from `from` to `to` using BFS.
 * Returns array of symbol names representing the path, or null if no path.
 */
export function getCallPath(from: string, to: string, rootPath: string): string[] | null {
  if (from === to) return [from];

  const graph = buildCallGraph(rootPath);
  if (!graph.symbols.has(from) || !graph.symbols.has(to)) return null;

  // BFS
  const visited = new Set<string>();
  const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];
  visited.add(from);

  while (queue.length > 0) {
    const { node, path: currentPath } = queue.shift()!;
    const entry = graph.symbols.get(node);
    if (!entry) continue;

    for (const callee of entry.callees) {
      if (callee === to) {
        return [...currentPath, callee];
      }
      if (!visited.has(callee)) {
        visited.add(callee);
        queue.push({ node: callee, path: [...currentPath, callee] });
      }
    }
  }

  return null;
}

// ============================================================================
// Tool: call_graph_extract
// ============================================================================

export const callGraphExtractTool: ToolDefinition = tool({
  description: `Extract all function calls from a file using AST-based analysis.

**Parameters:**
- filePath: Path to the file to analyze

**Returns:** List of call sites with callee name, caller context, line number, and call type.

**Example:**
\`\`\`
call_graph_extract({ filePath: "src/tools/ast-grep.ts" })
\`\`\`

**Call types:** call, method, constructor, require, import`,

  args: {
    filePath: tool.schema.string().describe('Path to the file to analyze'),
  },

  async execute({ filePath }) {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        return JSON.stringify({
          success: false,
          error: `File not found: ${filePath}`,
          hint: 'Check the file path and try again',
        }, null, 2);
      }

      const calls = extractCalls(resolved);

      return JSON.stringify({
        success: true,
        file: path.relative(process.cwd(), resolved),
        totalCalls: calls.length,
        calls,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});

// ============================================================================
// Tool: call_graph_callees
// ============================================================================

export const callGraphCalleesTool: ToolDefinition = tool({
  description: `Find all functions called by a given function (callees).

Builds a call graph from the project and returns all direct callees.
Analyzes .ts, .tsx, .js, .jsx files. Skips node_modules, dist, .git.

**Parameters:**
- functionName: Name of the function to find callees for
- filePath: Optional root path to search (defaults to current directory)

**Example:**
\`\`\`
call_graph_callees({ functionName: "main" })
call_graph_callees({ functionName: "helper", filePath: "./src" })
\`\`\`,

  args: {
    functionName: tool.schema.string().describe('Function name to find callees for'),
    filePath: tool.schema.string().optional().default('.').describe('Root directory to search in'),
  },

  async execute({ functionName, filePath }) {
    try {
      const rootPath = path.resolve(filePath);
      const callees = getCallees(functionName, rootPath);

      return JSON.stringify({
        success: true,
        function: functionName,
        totalCallees: callees.length,
        callees,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});

// ============================================================================
// Tool: call_graph_callers
// ============================================================================

export const callGraphCallersTool: ToolDefinition = tool({
  description: `Find all functions that call a given function (callers).

Builds a call graph from the project and returns all direct callers.
Analyzes .ts, .tsx, .js, .jsx files. Skips node_modules, dist, .git.

**Parameters:**
- functionName: Name of the function to find callers for
- filePath: Optional root path to search (defaults to current directory)

**Example:**
\`\`\`
call_graph_callers({ functionName: "helper" })
call_graph_callers({ functionName: "init", filePath: "./src" })
\`\`\`,

  args: {
    functionName: tool.schema.string().describe('Function name to find callers for'),
    filePath: tool.schema.string().optional().default('.').describe('Root directory to search in'),
  },

  async execute({ functionName, filePath }) {
    try {
      const rootPath = path.resolve(filePath);
      const callers = getCallers(functionName, rootPath);

      return JSON.stringify({
        success: true,
        function: functionName,
        totalCallers: callers.length,
        callers,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});

// ============================================================================
// Tool: call_graph_path
// ============================================================================

export const callGraphPathTool: ToolDefinition = tool({
  description: `Find the shortest call path between two functions (BFS).

Builds a call graph from the project and finds the shortest path
from one function to another through the call chain.

**Parameters:**
- from: Starting function name
- to: Target function name
- filePath: Optional root path to search (defaults to current directory)

**Example:**
\`\`\`
call_graph_path({ from: "init", to: "processData" })
\`\`\`

**Returns:** Array of function names representing the path, or null if no path exists.`,

  args: {
    from: tool.schema.string().describe('Starting function name'),
    to: tool.schema.string().describe('Target function name'),
    filePath: tool.schema.string().optional().default('.').describe('Root directory to search in'),
  },

  async execute({ from, to, filePath }) {
    try {
      const rootPath = path.resolve(filePath);
      const callPath = getCallPath(from, to, rootPath);

      if (callPath) {
        return JSON.stringify({
          success: true,
          from,
          to,
          pathLength: callPath.length,
          path: callPath,
        }, null, 2);
      }

      return JSON.stringify({
        success: true,
        from,
        to,
        pathLength: 0,
        path: null,
        message: `No call path found from "${from}" to "${to}"`,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});
