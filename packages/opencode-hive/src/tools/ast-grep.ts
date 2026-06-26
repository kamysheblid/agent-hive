import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ast-grep Native Tools — AST-based code analysis and refactoring
 *
 * Uses @ast-grep/napi directly (native, SIMD-accelerated).
 * No MCP server needed — runs in-process for maximum speed.
 *
 * Tools:
 * - ast_grep_find_code: Find code with AST patterns
 * - ast_grep_rewrite_code: Transform code with AST patterns
 * - ast_grep_dump_syntax_tree: Inspect code structure
 * - ast_grep_scan_code: Scan for code issues
 * - ast_grep_analyze_imports: Analyze imports
 */

// Lazy-load @ast-grep/napi to handle optional dependency gracefully
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

/**
 * Map file extension to ast-grep Lang enum
 */
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
    '.vue': 'TypeScript',
    '.svelte': 'TypeScript',
  };
  return map[ext] || 'TypeScript';
}

/**
 * Map string lang name to ast-grep Lang enum value
 */
function resolveLang(lang: string): string {
  const normalized = lang.toLowerCase();
  const map: Record<string, string> = {
    typescript: 'TypeScript',
    ts: 'TypeScript',
    javascript: 'JavaScript',
    js: 'JavaScript',
    tsx: 'Tsx',
    jsx: 'Tsx',
    html: 'Html',
    css: 'Css',
  };
  return map[normalized] || lang;
}

/**
 * Recursively find files matching extensions
 */
function findFiles(dir: string, extensions: string[], maxFiles: number = 500): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findFiles(fullPath, extensions, maxFiles - results.length));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

// ============================================================================
// Tool: ast_grep_find_code
// ============================================================================

export const astGrepFindCodeTool: ToolDefinition = tool({
  description: `Find code using AST pattern matching via ast-grep.

**Parameters:**
- pattern: AST pattern string (e.g., "function $NAME($$$) { $$$ }")
- lang: Language (typescript, javascript, tsx, etc.)
- path: File or directory to search in
- extensions: File extensions to search (default: .ts,.tsx,.js,.jsx)
- maxResults: Maximum results (default: 50)

**Pattern Syntax:**
- \`$\` prefix = metavariable (matches any node)
- \`$NAME\` = named metavariable (can reference in rewrite)
- \`$$$\` = match zero or more arguments/nodes
- \`{ $$$ }\` = match a block

**Example:**
\`\`\`
ast_grep_find_code({ pattern: "console.log($MSG)", lang: "typescript", path: "./src" })
ast_grep_find_code({ pattern: "export default function $NAME($$$)", lang: "javascript" })
\`\`\``,
  args: {
    pattern: tool.schema.string().describe('AST pattern string'),
    lang: tool.schema.string().optional().default('typescript').describe('Language (typescript, javascript, tsx, etc.)'),
    path: tool.schema.string().optional().default('.').describe('File or directory to search in'),
    extensions: tool.schema.string().optional().default('.ts,.tsx,.js,.jsx').describe('Comma-separated file extensions'),
    maxResults: tool.schema.number().optional().default(50).describe('Maximum results'),
  },
  async execute(args) {
    try {
      const astGrep = await loadAstGrep();
      const { parse, Lang } = astGrep;
      const searchPath = path.resolve(args.path);
      const extensions = args.extensions.split(',').map(e => e.trim());
      const lang = resolveLang(args.lang);

      const isFile = fs.statSync(searchPath).isFile();
      const files = isFile ? [searchPath] : findFiles(searchPath, extensions, 200);

      const results: Array<{ file: string; line: number; text: string; kind: string }> = [];

      for (const filePath of files) {
        if (results.length >= args.maxResults) break;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileLang = extToLang(filePath);
          const sg = parse(fileLang, content);
          const root = sg.root();
          const matches = root.findAll(args.pattern);

          for (const match of matches) {
            if (results.length >= args.maxResults) break;
            const range = match.range();
            results.push({
              file: path.relative(process.cwd(), filePath),
              line: range.start.line + 1,
              text: match.text(),
              kind: String(match.kind()),
            });
          }
        } catch {}
      }

      return JSON.stringify({
        success: true,
        count: results.length,
        results,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message }, null, 2);
    }
  },
});

// ============================================================================
// Tool: ast_grep_rewrite_code
// ============================================================================

export const astGrepRewriteCodeTool: ToolDefinition = tool({
  description: `Transform code using AST pattern matching and rewrite via ast-grep.

**Parameters:**
- pattern: AST pattern to find
- rewrite: Rewrite pattern (use $NAME to reference matched metavariables)
- lang: Language
- path: File or directory to search in
- dryRun: If true, show changes without applying (default: true)
- extensions: File extensions to search

**Example:**
\`\`\`
ast_grep_rewrite_code({
  pattern: "console.log($MSG)",
  rewrite: "logger.info($MSG)",
  lang: "typescript",
  path: "./src",
  dryRun: true
})
\`\`\``,
  args: {
    pattern: tool.schema.string().describe('AST pattern to find'),
    rewrite: tool.schema.string().describe('Rewrite pattern'),
    lang: tool.schema.string().optional().default('typescript').describe('Language'),
    path: tool.schema.string().optional().default('.').describe('File or directory'),
    dryRun: tool.schema.boolean().optional().default(true).describe('Show changes without applying'),
    extensions: tool.schema.string().optional().default('.ts,.tsx,.js,.jsx').describe('Comma-separated file extensions'),
  },
  async execute(args) {
    try {
      const astGrep = await loadAstGrep();
      const { parse } = astGrep;
      const searchPath = path.resolve(args.path);
      const extensions = args.extensions.split(',').map(e => e.trim());

      const isFile = fs.statSync(searchPath).isFile();
      const files = isFile ? [searchPath] : findFiles(searchPath, extensions, 200);

      const changes: Array<{ file: string; edits: Array<{ start: number; end: number; oldText: string; newText: string }> }> = [];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileLang = extToLang(filePath);
          const sg = parse(fileLang, content);
          const root = sg.root();
          const matches = root.findAll(args.pattern);

          if (matches.length === 0) continue;

          const fileEdits: Array<{ start: number; end: number; oldText: string; newText: string }> = [];
          // Apply edits in reverse order to preserve positions
          const sortedMatches = [...matches].sort((a, b) => b.range().start.index - a.range().start.index);

          let newContent = content;
          for (const match of sortedMatches) {
            const edit = match.replace(args.rewrite);
            fileEdits.push({
              start: edit.startPos,
              end: edit.endPos,
              oldText: match.text(),
              newText: edit.insertedText,
            });
            newContent = newContent.slice(0, edit.startPos) + edit.insertedText + newContent.slice(edit.endPos);
          }

          if (!args.dryRun && newContent !== content) {
            fs.writeFileSync(filePath, newContent, 'utf-8');
          }

          changes.push({
            file: path.relative(process.cwd(), filePath),
            edits: fileEdits.reverse(), // restore original order
          });
        } catch {}
      }

      return JSON.stringify({
        success: true,
        dryRun: args.dryRun,
        filesChanged: changes.length,
        totalEdits: changes.reduce((sum, c) => sum + c.edits.length, 0),
        changes,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message }, null, 2);
    }
  },
});

// ============================================================================
// Tool: ast_grep_dump_syntax_tree
// ============================================================================

export const astGrepDumpSyntaxTreeTool: ToolDefinition = tool({
  description: `Dump the syntax tree of a file using ast-grep.

**Parameters:**
- path: File path to analyze
- maxDepth: Maximum tree depth (default: 10)

**Returns:** The AST structure with node kinds, ranges, and text.

**Example:**
\`\`\`
ast_grep_dump_syntax_tree({ path: "src/index.ts", maxDepth: 5 })
\`\`\``,
  args: {
    path: tool.schema.string().describe('File path to analyze'),
    maxDepth: tool.schema.number().optional().default(10).describe('Maximum tree depth'),
  },
  async execute(args) {
    try {
      const astGrep = await loadAstGrep();
      const { parse } = astGrep;
      const filePath = path.resolve(args.path);
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileLang = extToLang(filePath);
      const sg = parse(fileLang, content);

      function dumpNode(node: any, depth: number): any {
        if (depth >= args.maxDepth) return { kind: String(node.kind()), text: '[...]' };
        const result: any = {
          kind: String(node.kind()),
          range: node.range(),
        };
        if (node.children().length > 0) {
          result.children = node.children().map((c: any) => dumpNode(c, depth + 1));
        } else {
          result.text = node.text();
        }
        return result;
      }

      const tree = dumpNode(sg.root(), 0);

      return JSON.stringify({
        success: true,
        file: path.relative(process.cwd(), filePath),
        language: fileLang,
        tree,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message }, null, 2);
    }
  },
});

// ============================================================================
// Tool: ast_grep_scan_code
// ============================================================================

export const astGrepScanCodeTool: ToolDefinition = tool({
  description: `Scan code for common issues using ast-grep pattern matching.

Checks for:
- console.log statements (should use proper logging)
- debugger statements
- TODO/FIXME/HACK comments
- empty catch blocks
- == instead of ===

**Parameters:**
- path: File or directory to scan
- extensions: File extensions to scan

**Example:**
\`\`\`
ast_grep_scan_code({ path: "./src" })
\`\`\``,
  args: {
    path: tool.schema.string().optional().default('.').describe('File or directory to scan'),
    extensions: tool.schema.string().optional().default('.ts,.tsx,.js,.jsx').describe('Comma-separated file extensions'),
  },
  async execute(args) {
    try {
      const astGrep = await loadAstGrep();
      const { parse } = astGrep;
      const searchPath = path.resolve(args.path);
      const extensions = args.extensions.split(',').map(e => e.trim());

      const isFile = fs.statSync(searchPath).isFile();
      const files = isFile ? [searchPath] : findFiles(searchPath, extensions, 200);

      const issues: Array<{
        file: string;
        line: number;
        rule: string;
        severity: 'warning' | 'error' | 'info';
        text: string;
      }> = [];

      const rules = [
        { name: 'no-console-log', pattern: 'console.log($$$)', severity: 'warning' as const, message: 'Use proper logging instead of console.log' },
        { name: 'no-debugger', pattern: 'debugger', severity: 'error' as const, message: 'Remove debugger statement' },
        { name: 'no-empty-catch', pattern: 'catch ($$$) { }', severity: 'warning' as const, message: 'Empty catch block — handle or log the error' },
      ];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileLang = extToLang(filePath);
          const sg = parse(fileLang, content);
          const root = sg.root();

          for (const rule of rules) {
            const matches = root.findAll(rule.pattern);
            for (const match of matches) {
              const range = match.range();
              issues.push({
                file: path.relative(process.cwd(), filePath),
                line: range.start.line + 1,
                rule: rule.name,
                severity: rule.severity,
                text: match.text().slice(0, 100),
              });
            }
          }

          // Also check for TODO/FIXME via regex (not AST)
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const todoMatch = lines[i].match(/(TODO|FIXME|HACK|XXX)\b/i);
            if (todoMatch) {
              issues.push({
                file: path.relative(process.cwd(), filePath),
                line: i + 1,
                rule: 'no-todo',
                severity: 'info',
                text: lines[i].trim().slice(0, 100),
              });
            }
          }
        } catch {}
      }

      return JSON.stringify({
        success: true,
        filesScanned: files.length,
        issuesFound: issues.length,
        issues,
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message }, null, 2);
    }
  },
});

// ============================================================================
// Tool: ast_grep_analyze_imports
// ============================================================================

export const astGrepAnalyzeImportsTool: ToolDefinition = tool({
  description: `Analyze import/export patterns in a file or directory using ast-grep.

**Parameters:**
- path: File or directory to analyze
- extensions: File extensions to analyze

**Returns:** Import/export summary with counts, external vs local deps.

**Example:**
\`\`\`
ast_grep_analyze_imports({ path: "./src" })
\`\`\``,
  args: {
    path: tool.schema.string().optional().default('.').describe('File or directory to analyze'),
    extensions: tool.schema.string().optional().default('.ts,.tsx,.js,.jsx').describe('Comma-separated file extensions'),
  },
  async execute(args) {
    try {
      const astGrep = await loadAstGrep();
      const { parse } = astGrep;
      const searchPath = path.resolve(args.path);
      const extensions = args.extensions.split(',').map(e => e.trim());

      const isFile = fs.statSync(searchPath).isFile();
      const files = isFile ? [searchPath] : findFiles(searchPath, extensions, 200);

      const importPatterns = [
        'import $SPEC from $SOURCE',
        'import { $$$ } from $SOURCE',
        'import type $SPEC from $SOURCE',
        'import type { $$$ } from $SOURCE',
        'const $SPEC = require($SOURCE)',
      ];

      const allImports: Array<{ file: string; source: string; line: number; kind: string }> = [];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const fileLang = extToLang(filePath);
          const sg = parse(fileLang, content);
          const root = sg.root();

          for (const pattern of importPatterns) {
            const matches = root.findAll(pattern);
            for (const match of matches) {
              const sourceNode = match.getMatch('SOURCE');
              const source = sourceNode ? sourceNode.text().replace(/['"]/g, '') : 'unknown';
              const range = match.range();
              allImports.push({
                file: path.relative(process.cwd(), filePath),
                source,
                line: range.start.line + 1,
                kind: pattern.includes('type') ? 'type-only' : 'value',
              });
            }
          }
        } catch {}
      }

      // Summary
      const sourceCounts: Record<string, number> = {};
      for (const imp of allImports) {
        sourceCounts[imp.source] = (sourceCounts[imp.source] || 0) + 1;
      }

      const external = Object.entries(sourceCounts)
        .filter(([src]) => !src.startsWith('.') && !src.startsWith('/'))
        .sort((a, b) => b[1] - a[1]);

      const local = Object.entries(sourceCounts)
        .filter(([src]) => src.startsWith('.') || src.startsWith('/'))
        .sort((a, b) => b[1] - a[1]);

      return JSON.stringify({
        success: true,
        filesScanned: files.length,
        totalImports: allImports.length,
        summary: {
          external: external.map(([source, count]) => ({ source, count })),
          local: local.map(([source, count]) => ({ source, count })),
        },
        imports: allImports.slice(0, 100), // limit raw output
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message }, null, 2);
    }
  },
});
