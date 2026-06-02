import { tool, type ToolDefinition, type ToolContext } from '@opencode-ai/plugin';
import { execSync } from 'child_process';

/**
 * Build repomix CLI args from function parameters.
 */
function buildArgs(args: RepomixArgs): string[] {
  const cliArgs = ['npx', '--yes', 'repomix'];

  // Remote repo URL
  if (args.url) {
    cliArgs.push('--remote', args.url);
  }

  // stdout output
  cliArgs.push('--stdout');

  // Output style
  if (args.style) {
    cliArgs.push('--style', args.style);
  } else {
    cliArgs.push('--style', 'markdown');
  }

  // Include patterns (comma-separated)
  if (args.include) {
    cliArgs.push('--include', args.include);
  }

  // Ignore patterns (comma-separated)
  if (args.ignore) {
    cliArgs.push('--ignore', args.ignore);
  }

  // Compression
  if (args.compress) {
    cliArgs.push('--compress');
  }

  // Security check (default: on)
  if (args.noSecurityCheck) {
    cliArgs.push('--no-security-check');
  }

  // Remove comments
  if (args.removeComments) {
    cliArgs.push('--remove-comments');
  }

  // Remove empty lines
  if (args.removeEmptyLines) {
    cliArgs.push('--remove-empty-lines');
  }

  // Top files count
  if (args.topFilesLen !== undefined) {
    cliArgs.push('--top-files-len', String(args.topFilesLen));
  }

  return cliArgs;
}

export interface RepomixArgs {
  /** GitHub repository URL or user/repo shorthand */
  url: string;
  /** Output style: xml (default), markdown, json, plain */
  style?: 'xml' | 'markdown' | 'json' | 'plain';
  /** Include only files matching these glob patterns (comma-separated) */
  include?: string;
  /** Additional patterns to exclude (comma-separated) */
  ignore?: string;
  /** Extract essential code structure (classes, functions, interfaces) */
  compress?: boolean;
  /** Skip scanning for sensitive data */
  noSecurityCheck?: boolean;
  /** Strip all code comments before packing */
  removeComments?: boolean;
  /** Remove blank lines from all files */
  removeEmptyLines?: boolean;
  /** Number of largest files to show in summary (default: 5) */
  topFilesLen?: number;
}

export const repomixTool: ToolDefinition = tool({
  description:
    "Fetch a GitHub repository's full content via repomix. Returns directory tree and file contents optimized for LLM analysis. Use when you need to understand an external repository's structure or code. Powered by repomix (https://github.com/yamadashy/repomix) — 25k+ stars, actively maintained.",

  args: {
    url: tool.schema
      .string()
      .describe(
        "GitHub repository URL (e.g., 'https://github.com/owner/repo') or shorthand ('owner/repo')",
      ),
    style: tool.schema
      .enum(['xml', 'markdown', 'json', 'plain'])
      .optional()
      .describe('Output format (default: markdown)'),
    include: tool.schema
      .string()
      .optional()
      .describe(
        "Include only files matching these glob patterns (comma-separated, e.g., 'src/**/*.ts,*.md')",
      ),
    ignore: tool.schema
      .string()
      .optional()
      .describe(
        "Additional patterns to exclude (comma-separated, e.g., '*.test.ts,docs/**')",
      ),
    compress: tool.schema
      .boolean()
      .optional()
      .describe(
        'Extract essential code structure (classes, functions, interfaces) using Tree-sitter parsing',
      ),
    noSecurityCheck: tool.schema
      .boolean()
      .optional()
      .describe('Skip scanning for sensitive data like API keys and passwords'),
    removeComments: tool.schema
      .boolean()
      .optional()
      .describe('Strip all code comments before packing'),
    removeEmptyLines: tool.schema
      .boolean()
      .optional()
      .describe('Remove blank lines from all files'),
    topFilesLen: tool.schema
      .number()
      .optional()
      .describe('Number of largest files to show in summary (default: 5)'),
  },

  async execute(args: RepomixArgs, _context: ToolContext) {
    const cliArgs = buildArgs(args);
    try {
      const output = execSync(cliArgs.join(' '), {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        timeout: 120_000, // 2 minute timeout
      });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Check for common issues
      if (message.includes('command not found') || message.includes('ENOENT')) {
        return `Error: repomix failed to run. Try installing it first:
  npm install -g repomix

Then try again.`;
      }
      if (message.includes('Remote repository')) {
        return `Error: Could not process remote repository '${args.url}'.
Check that the URL is correct and the repository is public.

Usage examples:
  - https://github.com/owner/repo
  - owner/repo (shorthand)`;
      }
      return `Error running repomix: ${message}`;
    }
  },
});
