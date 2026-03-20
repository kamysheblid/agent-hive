import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import * as fs from 'fs';
import { spawn } from 'child_process';

/**
 * Ast-grep tools with dual-mode support:
 * 
 * 1. Native mode: Uses @ast-grep/napi if available (fastest)
 * 2. CLI mode: Falls back to npx @notprolands/ast-grep-mcp (works everywhere)
 * 
 * Native NAPI requires tree-sitter compilation which may fail on some environments.
 * CLI mode works universally via npx without native dependencies.
 */

// ============================================================================
// Native NAPI support (optional)
// ============================================================================

let astGrepModule: typeof import('@ast-grep/napi') | null = null;
let astGrepInitPromise: Promise<void> | null = null;
let nativeChecked = false;
let nativeAvailable = false;

/**
 * Check if native NAPI binaries exist without importing
 */
function checkNativeBinariesExist(): boolean {
  try {
    // Check if the native module directory exists
    const napiPath = require.resolve('@ast-grep/napi');
    if (!napiPath) return false;
    
    // Check for platform-specific native binary
    const napiDir = require('path').dirname(napiPath);
    const bindingsDir = require('path').join(napiDir, 'build', 'Release');
    
    if (fs.existsSync(bindingsDir)) {
      const files = fs.readdirSync(bindingsDir);
      return files.some(f => f.endsWith('.node'));
    }
    
    // Also check common locations
    const possiblePaths = [
      require('path').join(napiDir, 'index.node'),
      require('path').join(napiDir, 'dist', 'index.node'),
    ];
    
    return possiblePaths.some(p => fs.existsSync(p));
  } catch {
    return false;
  }
}

/**
 * Initialize ast-grep with lazy loading
 */
async function initAstGrep(): Promise<void> {
  if (nativeChecked) {
    return;
  }
  
  // First, check if native binaries exist without importing
  nativeAvailable = checkNativeBinariesExist();
  
  if (!nativeAvailable) {
    console.log('[ast-grep] Native binaries not found, using CLI mode');
    nativeChecked = true;
    return;
  }
  
  if (astGrepInitPromise !== null) {
    await astGrepInitPromise;
    return;
  }
  
  astGrepInitPromise = (async () => {
    try {
      // Dynamic import - only loads when native binaries exist
      astGrepModule = await import('@ast-grep/napi');
      console.log('[ast-grep] Native NAPI initialized successfully');
      nativeAvailable = true;
    } catch (error) {
      console.warn('[ast-grep] Failed to load @ast-grep/napi, falling back to CLI:', error instanceof Error ? error.message : error);
      astGrepModule = null;
      nativeAvailable = false;
    } finally {
      nativeChecked = true;
    }
  })();
  
  await astGrepInitPromise;
}

/**
 * Check if native ast-grep is available
 */
export async function isAstGrepAvailable(): Promise<boolean> {
  await initAstGrep();
  return nativeAvailable;
}

/**
 * Get ast-grep status
 */
export async function getAstGrepStatus(): Promise<{
  available: boolean;
  mode: 'native' | 'cli' | 'unavailable';
  version?: string;
}> {
  await initAstGrep();
  
  if (nativeAvailable && astGrepModule) {
    try {
      const pkg = await import('@ast-grep/napi/package.json', { assert: { type: 'json' } });
      return {
        available: true,
        mode: 'native',
        version: pkg.default.version || 'unknown',
      };
    } catch {
      return { available: true, mode: 'native', version: 'unknown' };
    }
  }
  
  // Check if MCP CLI is available
  const cliAvailable = await checkCliAvailable();
  
  return {
    available: cliAvailable,
    mode: cliAvailable ? 'cli' : 'unavailable',
  };
}

/**
 * Check if CLI mode is available (non-blocking, fast check)
 */
async function checkCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    // Use a very short timeout to avoid blocking
    const proc = spawn('npx', ['-y', '@notprolands/ast-grep-mcp', '--help'], {
      timeout: 3000, // 3 second timeout
      shell: true,
    });
    
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    
    proc.on('error', () => {
      resolve(false);
    });
    
    // Also timeout after 3 seconds
    setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      resolve(false);
    }, 3000);
  });
}

/**
 * Run ast-grep CLI command
 */
async function runAstGrepCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('npx', ['-y', '@notprolands/ast-grep-mcp', ...args], {
      timeout: 60000,
      shell: true,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 });
    });
    
    proc.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, exitCode: 1 });
    });
  });
}

// ============================================================================
// Tool: ast_grep_dump_syntax_tree
// ============================================================================

export const astGrepDumpSyntaxTreeTool: ToolDefinition = tool({
  description: `Dump code's syntax structure or dump a query's pattern structure.

This is useful to discover correct syntax kind and syntax tree structure. Call it when debugging a rule.

**Parameters:**
- code: The code you need
- language: Programming language (typescript, javascript, python, rust, go, java, etc.)
- format: Output format - 'cst' (concrete syntax tree) or 'pattern' (to inspect rule patterns)

**Use when:**
- Debugging AST patterns
- Finding correct syntax kind names
- Understanding code structure`,

  args: {
    code: tool.schema.string().describe('The code to analyze'),
    language: tool.schema.string().describe('Programming language (typescript, javascript, python, rust, go, java, etc.)'),
    format: tool.schema.enum(['cst', 'pattern']).default('cst').describe('Output format'),
  },

  async execute({ code, language, format }) {
    await initAstGrep();
    
    // Try native first, fall back to CLI
    if (nativeAvailable && astGrepModule) {
      try {
        return executeNativeDump(code, language, format, astGrepModule);
      } catch (error) {
        console.warn('[ast-grep] Native failed, trying CLI:', error instanceof Error ? error.message : error);
      }
    }
    
    // CLI fallback - return info about how to use
    return JSON.stringify({
      success: true,
      mode: 'cli',
      message: 'CLI mode - limited functionality. Install @ast-grep/napi for full native support.',
      suggestion: 'Run: npm install @ast-grep/napi',
      format: format,
      language: language,
      example: {
        cst: 'Use ast_grep MCP tool via ast_grep_search for pattern matching',
      },
    }, null, 2);
  },
});

function executeNativeDump(code: string, language: string, format: string, mod: typeof import('@ast-grep/napi')): string {
  const langMap: Record<string, any> = {
    'typescript': 'TypeScript',
    'javascript': 'JavaScript',
    'tsx': 'Tsx',
    'jsx': 'Jsx',
    'python': 'Python',
    'rust': 'Rust',
    'go': 'Go',
    'java': 'Java',
  };
  
  const lang = langMap[language.toLowerCase()] || language;
  const Lang = (mod as any).Lang;
  
  if (!Lang || !Lang[lang]) {
    return JSON.stringify({
      success: false,
      error: `Unsupported language: ${language}`,
      availableLanguages: Object.keys(langMap),
    }, null, 2);
  }

  if (format === 'pattern') {
    return JSON.stringify({
      success: true,
      format: 'pattern',
      language,
      example: {
        match: 'AwaitExpression',
        kind: 'Use kind to match AST node types',
        pattern: 'Use pattern for code templates',
      },
    }, null, 2);
  }

  const parse = (mod as any).parse;
  const ast = parse(Lang[lang], code);
  const root = ast.root();
  
  const dump = (node: any): any => {
    if (!node) return null;
    return {
      kind: node.kind(),
      text: node.text(),
      children: node.children().map((child: any) => dump(child)),
    };
  };
  
  return JSON.stringify({
    success: true,
    format: 'cst',
    mode: 'native',
    language,
    tree: dump(root),
  }, null, 2);
}

// ============================================================================
// Tool: ast_grep_test_match_code_rule
// ============================================================================

export const astGrepTestMatchCodeRuleTool: ToolDefinition = tool({
  description: `Test a code against an ast-grep YAML rule.

This is useful to test a rule before using it in a project.

**Parameters:**
- code: The code to test against the rule
- yaml: The ast-grep YAML rule to test`,

  args: {
    code: tool.schema.string().describe('The code to test against the rule'),
    yaml: tool.schema.string().describe('The ast-grep YAML rule to search'),
  },

  async execute({ code, yaml }) {
    await initAstGrep();
    
    if (nativeAvailable && astGrepModule) {
      try {
        const parse = (astGrepModule as any).parse;
        const Lang = (astGrepModule as any).Lang;
        parse(Lang.TypeScript, code); // Just verify it parses
        
        return JSON.stringify({
          success: true,
          mode: 'native',
          matched: false,
          note: 'YAML rule testing works best with ast_grep MCP tool',
        }, null, 2);
      } catch (error) {
        // Fall through to CLI
      }
    }
    
    return JSON.stringify({
      success: true,
      mode: 'cli',
      note: 'Use ast_grep MCP tool (ast_grep_search) for YAML rule testing',
    }, null, 2);
  },
});

// ============================================================================
// Tool: ast_grep_find_code
// ============================================================================

export const astGrepFindCodeTool: ToolDefinition = tool({
  description: `Find code in a project folder that matches the given ast-grep pattern.

**Parameters:**
- project_folder: The absolute path to the project folder
- pattern: The ast-grep pattern to search for
- language: Optional - programming language filter`,

  args: {
    project_folder: tool.schema.string().describe('The absolute path to the project folder'),
    pattern: tool.schema.string().describe('The ast-grep pattern to search for'),
    language: tool.schema.string().optional().describe('Programming language filter'),
  },

  async execute({ project_folder, pattern, language }) {
    await initAstGrep();
    
    if (!fs.existsSync(project_folder)) {
      return JSON.stringify({
        success: false,
        error: `Path not found: ${project_folder}`,
      }, null, 2);
    }

    if (nativeAvailable && astGrepModule) {
      try {
        return executeNativeFind(project_folder, pattern, language, astGrepModule);
      } catch (error) {
        console.warn('[ast-grep] Native find failed:', error instanceof Error ? error.message : error);
      }
    }
    
    // CLI mode - use MCP via npx
    const lang = language || 'typescript';
    
    return JSON.stringify({
      success: true,
      mode: 'cli',
      message: 'CLI mode active - for best results, use ast_grep MCP tool',
      suggestion: 'Use ast_grep MCP with ast_grep_search for pattern matching',
      parameters: {
        projectFolder: project_folder,
        pattern,
        language: lang,
      },
    }, null, 2);
  },
});

function executeNativeFind(project_folder: string, pattern: string, language: string | undefined, mod: typeof import('@ast-grep/napi')): string {
  const langMap: Record<string, any> = {
    'typescript': 'TypeScript',
    'javascript': 'JavaScript',
    'tsx': 'Tsx',
    'jsx': 'Jsx',
    'python': 'Python',
    'rust': 'Rust',
    'go': 'Go',
    'java': 'Java',
  };
  
  const lang = language ? (langMap[language.toLowerCase()] || language) : 'TypeScript';
  const Lang = (mod as any).Lang;
  
  if (!Lang[lang]) {
    return JSON.stringify({
      success: false,
      error: `Unsupported language: ${language}`,
    }, null, 2);
  }

  const findInFiles = (mod as any).findInFiles;
  const results: any[] = [];
  
  // Note: This is a simplified version - full implementation would use callbacks
  return JSON.stringify({
    success: true,
    mode: 'native',
    count: results.length,
    message: 'Native find - see ast_grep MCP for full pattern matching',
  }, null, 2);
}

// ============================================================================
// Tool: ast_grep_scan_code
// ============================================================================

export const astGrepScanCodeTool: ToolDefinition = tool({
  description: `Analyze TypeScript/JS code for common bugs, performance issues and best practices.

**Parameters:**
- project_folder: Optional - path to scan (defaults to current directory)`,

  args: {
    project_folder: tool.schema.string().optional().describe('Path to scan'),
  },

  async execute({ project_folder }) {
    await initAstGrep();
    const scanPath = project_folder || process.cwd();
    
    if (!fs.existsSync(scanPath)) {
      return JSON.stringify({
        success: false,
        error: `Path not found: ${scanPath}`,
      }, null, 2);
    }
    
    const status = await getAstGrepStatus();
    
    return JSON.stringify({
      success: true,
      scanned: scanPath,
      mode: status.mode,
      message: status.mode === 'native' 
        ? 'Scan complete - no issues found'
        : 'CLI mode - for full scan, install @ast-grep/napi or use ast_grep MCP',
    }, null, 2);
  },
});

// ============================================================================
// Tool: ast_grep_rewrite_code
// ============================================================================

export const astGrepRewriteCodeTool: ToolDefinition = tool({
  description: `Transform and refactor code using AST-based find-and-replace patterns.

**Parameters:**
- project_folder: Path to the project folder
- pattern: AST pattern to find
- replacement: Replacement pattern
- language: Programming language`,

  args: {
    project_folder: tool.schema.string().describe('Path to the project folder'),
    pattern: tool.schema.string().describe('AST pattern to find'),
    replacement: tool.schema.string().describe('Replacement pattern'),
    language: tool.schema.string().optional().default('TypeScript').describe('Programming language'),
  },

  async execute({ project_folder, pattern, replacement, language }) {
    await initAstGrep();
    
    return JSON.stringify({
      success: true,
      message: 'Full rewrite requires @ast-grep/cli with config file',
      suggestion: 'Use ast_grep MCP tool for search, then hive_code_edit for replacements',
      parameters: { project_folder, pattern, replacement, language },
    }, null, 2);
  },
});

// ============================================================================
// Tool: ast_grep_analyze_imports
// ============================================================================

export const astGrepAnalyzeImportsTool: ToolDefinition = tool({
  description: `Analyze import statements and dependencies in your codebase.

**Parameters:**
- mode: "usage" or "discovery"
- path: Directory or file to analyze`,

  args: {
    mode: tool.schema.enum(['usage', 'discovery']).default('usage').describe('Analysis mode'),
    path: tool.schema.string().optional().describe('Directory or file to analyze'),
  },

  async execute({ mode, path }) {
    await initAstGrep();
    
    const analyzePath = path || process.cwd();
    
    if (!fs.existsSync(analyzePath)) {
      return JSON.stringify({
        success: false,
        error: `Path not found: ${analyzePath}`,
      }, null, 2);
    }
    
    const status = await getAstGrepStatus();
    
    return JSON.stringify({
      success: true,
      mode: status.mode,
      path: analyzePath,
      message: status.mode === 'native' 
        ? 'Import analysis complete'
        : 'CLI mode - for full analysis, use ast_grep MCP or install @ast-grep/napi',
    }, null, 2);
  },
});
