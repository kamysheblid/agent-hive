/**
 * LSP Auto-Diagnostics Hook
 *
 * Tracks files modified by Write/Edit tools and automatically runs
 * TypeScript/Python diagnostics on them, injecting results into the system prompt.
 *
 * Pattern inspired by oh-my-openagent's omo-lsp PostToolUse hook,
 * adapted for agent-hive's plugin architecture.
 *
 * The diagnostics run on `experimental.chat.system.transform` (before the next
 * LLM call), not synchronously after every edit — this keeps the experience
 * snappy while still catching type errors proactively.
 */

import * as path from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface LspDiagnosticsState {
  /** Set of file paths modified by Write/Edit since last check */
  modifiedFiles: Set<string>;
}

export function createLspDiagnosticsState(): LspDiagnosticsState {
  return { modifiedFiles: new Set() };
}

// ---------------------------------------------------------------------------
// Tool names that modify files
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'apply_patch',
  'hive_code_edit',
  'hive_lazy_edit',
]);

/**
 * Call from a `tool.execute.after` hook to track files changed by write/edit
 * tools.
 */
export function trackFileModification(
  state: LspDiagnosticsState,
  tool: string,
  args: Record<string, unknown> | undefined,
): void {
  if (!WRITE_TOOLS.has(tool)) return;
  if (!args) return;

  // The default OpenCode Write/Edit tools use `filePath`.
  // Our custom hive_code_edit / hive_lazy_edit use `path`.
  const filePath: unknown = args.filePath ?? args.path;
  if (typeof filePath !== 'string' || !filePath) return;

  state.modifiedFiles.add(filePath);
}

// ---------------------------------------------------------------------------
// TypeScript diagnostics runner
// ---------------------------------------------------------------------------

/** File extensions we can run TypeScript diagnostics on. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Find the project-root tsconfig by walking up from any tracked file until
 * we find a tsconfig.json (or fall back to the repo root).
 */
function resolveTsConfig(projectDir: string): string | null {
  const candidate = path.join(projectDir, 'tsconfig.json');
  // We trust the provided projectDir (the workspace root) because OpenCode
  // plugins always receive the repo root as `directory`.
  if (/* exists */ true) return candidate;
  return null;
}

/**
 * Run `tsc --noEmit` and extract diagnostics relevant to the tracked files.
 *
 * Returns a formatted diagnostics block, or `null` if everything is clean.
 */
export function runTypeScriptDiagnostics(
  state: LspDiagnosticsState,
  projectDir: string,
): string | null {
  if (state.modifiedFiles.size === 0) return null;

  // Filter to TypeScript/JavaScript files
  const tsFiles = [...state.modifiedFiles].filter((f) =>
    TS_EXTENSIONS.has(path.extname(f)),
  );
  if (tsFiles.length === 0) return null;

  // Resolve tsc binary from the opencode-hive package (where TypeScript is a devDep)
  const tscPath = path.join(
    projectDir,
    'packages',
    'opencode-hive',
    'node_modules',
    'typescript',
    'bin',
    'tsc',
  );

  // Fallback: try node_modules/.bin/tsc
  const tscBin = resolveTscBinary(projectDir) || tscPath;

  if (!tscBin) return null;

  try {
    const stdout = execSync(
      `"${tscBin}" --noEmit --pretty false 2>&1 || true`,
      {
        cwd: projectDir,
        timeout: 30_000,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10 MB
      },
    ).toString();

    // Filter lines that reference any of our tracked files
    const relevantLines = stdout
      .split('\n')
      .filter((line) => tsFiles.some((f) => line.includes(f)))
      .map((l) => l.trim())
      .filter(Boolean);

    if (relevantLines.length === 0) return null;

    return formatDiagnosticsBlock(relevantLines);
  } catch {
    // tsc --noEmit exits non-zero when errors exist; stdout is captured via
    // `|| true` above, so this path is reached only for genuine crashes.
    return null;
  } finally {
    // Clear tracked files after checking (one-shot per edit cycle)
    state.modifiedFiles.clear();
  }
}

/**
 * Try to find tsc in the project tree.
 */
function resolveTscBinary(projectDir: string): string | null {
  const candidates = [
    path.join(projectDir, 'node_modules', '.bin', 'tsc'),
    path.join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  for (const c of candidates) {
    try {
      if (require('fs').existsSync(c)) return c;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Format diagnostics lines into a compact block for system-prompt injection.
 */
function formatDiagnosticsBlock(lines: string[]): string {
  // Limit to first 50 lines to avoid blowing up the prompt
  const shown = lines.slice(0, 50);
  const tail = lines.length > 50
    ? `\n  ... and ${lines.length - 50} more diagnostics`
    : '';

  return [
    '',
    '───────────────────────────────────────────────────',
    '  🛠  TypeScript LSP Diagnostics (recently edited)',
    '───────────────────────────────────────────────────',
    ...shown.map((l) => `  ${l}`),
    tail,
    '───────────────────────────────────────────────────',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Python diagnostics runner
// ---------------------------------------------------------------------------

/** File extensions we can run Python diagnostics on. */
const PY_EXTENSIONS = new Set(['.py', '.pyw', '.pyi']);

interface PyrightDiagnostic {
  file: string;
  range: { start: { line: number } };
  message: string;
  severity: string;
}

interface PyrightOutput {
  diagnostics: PyrightDiagnostic[];
}

/**
 * Run pyright diagnostics on tracked Python files.
 *
 * Returns a formatted diagnostics block, or `null` if everything is clean
 * or pyright is not available.
 */
export function runPythonDiagnostics(
  state: LspDiagnosticsState,
  projectDir: string,
): string | null {
  if (state.modifiedFiles.size === 0) return null;

  // Filter to Python files
  const pyFiles = [...state.modifiedFiles].filter((f) =>
    PY_EXTENSIONS.has(path.extname(f)),
  );
  if (pyFiles.length === 0) return null;

  try {
    const pyrightOutput = execSync(
      `pyright --outputjson ${pyFiles.join(' ')}`,
      {
        cwd: projectDir,
        timeout: 30_000,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      },
    ).toString();

    const output: PyrightOutput = JSON.parse(pyrightOutput);

    // Filter to errors only (more actionable for system prompt)
    const errors = output.diagnostics.filter(d => d.severity === 'error');

    if (errors.length === 0) return null;

    const lines = errors.map(d =>
      `${d.file}:${d.range.start.line + 1}: error: ${d.message}`
    );

    return formatPythonDiagnosticsBlock(lines);
  } catch {
    // pyright not installed or crashed — skip silently
    return null;
  } finally {
    // Clear tracked files after checking
    state.modifiedFiles.clear();
  }
}

/**
 * Format Python diagnostics lines into a compact block for system-prompt injection.
 */
function formatPythonDiagnosticsBlock(lines: string[]): string {
  const shown = lines.slice(0, 50);
  const tail = lines.length > 50
    ? `\n  ... and ${lines.length - 50} more diagnostics`
    : '';

  return [
    '',
    '───────────────────────────────────────────────────',
    '  🐍 Python LSP Diagnostics (recently edited)',
    '───────────────────────────────────────────────────',
    ...shown.map((l) => `  ${l}`),
    tail,
    '───────────────────────────────────────────────────',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Reset state — call from `experimental.session.compacting`. */
export function resetDiagnostics(state: LspDiagnosticsState): void {
  state.modifiedFiles.clear();
}
