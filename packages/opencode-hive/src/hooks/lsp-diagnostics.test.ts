import { describe, expect, it, vi, beforeEach } from 'bun:test';
import {
  createLspDiagnosticsState,
  trackFileModification,
  runTypeScriptDiagnostics,
  runPythonDiagnostics,
  resetDiagnostics,
} from './lsp-diagnostics.js';

// Mock child_process for Python diagnostics tests
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

describe('LSP Diagnostics State', () => {
  it('creates empty state', () => {
    const state = createLspDiagnosticsState();
    expect(state.modifiedFiles.size).toBe(0);
  });

  it('tracks write tool modifications', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.ts' });
    expect(state.modifiedFiles.has('/test/file.ts')).toBe(true);
    expect(state.modifiedFiles.size).toBe(1);
  });

  it('tracks edit tool modifications', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'edit', { filePath: '/test/file.ts' });
    expect(state.modifiedFiles.has('/test/file.ts')).toBe(true);
  });

  it('tracks hive_code_edit tool modifications via path', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'hive_code_edit', { path: '/test/file.ts' });
    expect(state.modifiedFiles.has('/test/file.ts')).toBe(true);
  });

  it('tracks hive_lazy_edit tool modifications', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'hive_lazy_edit', { path: '/test/file.ts' });
    expect(state.modifiedFiles.has('/test/file.ts')).toBe(true);
  });

  it('ignores read-only tools', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'read', { filePath: '/test/file.ts' });
    trackFileModification(state, 'grep', { pattern: 'foo' });
    trackFileModification(state, 'glob', { pattern: '*.ts' });
    expect(state.modifiedFiles.size).toBe(0);
  });

  it('ignores null filePath', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { content: 'test' });
    expect(state.modifiedFiles.size).toBe(0);
  });

  it('deduplicates multiple writes to same file', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.ts' });
    trackFileModification(state, 'edit', { filePath: '/test/file.ts' });
    expect(state.modifiedFiles.size).toBe(1);
  });

  it('resets state', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.ts' });
    expect(state.modifiedFiles.size).toBe(1);
    resetDiagnostics(state);
    expect(state.modifiedFiles.size).toBe(0);
  });

  it('runTypeScriptDiagnostics returns null when no files tracked', () => {
    const state = createLspDiagnosticsState();
    const result = runTypeScriptDiagnostics(state, '/tmp');
    expect(result).toBeNull();
  });

  it('runTypeScriptDiagnostics returns null for non-TS files', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.py' });
    trackFileModification(state, 'write', { filePath: '/test/file.json' });
    const result = runTypeScriptDiagnostics(state, '/tmp');
    expect(result).toBeNull();
  });

  it('runTypeScriptDiagnostics clears tracked files after run', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.ts' });
    runTypeScriptDiagnostics(state, '/tmp');
    // Even though diagnostics might fail (no tsc in /tmp), files should be cleared
    expect(state.modifiedFiles.size).toBe(0);
  });
});

describe('Python diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runPythonDiagnostics returns null when no Python files tracked', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.ts' });
    const result = runPythonDiagnostics(state, '/tmp');
    expect(result).toBeNull();
  });

  it('runPythonDiagnostics returns null for non-Python files', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.ts' });
    trackFileModification(state, 'write', { filePath: '/test/file.json' });
    const result = runPythonDiagnostics(state, '/tmp');
    expect(result).toBeNull();
  });

  it('runPythonDiagnostics clears tracked files after run', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.py' });
    // Even if pyright fails, files should be cleared
    mockExecSync.mockImplementation(() => { throw new Error('pyright not found'); });
    runPythonDiagnostics(state, '/tmp');
    expect(state.modifiedFiles.size).toBe(0);
  });

  it('runPythonDiagnostics calls pyright --outputjson for Python files', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.py' });
    trackFileModification(state, 'write', { filePath: '/test/file2.py' });
    
    mockExecSync.mockReturnValue(JSON.stringify({
      diagnostics: [],
    }));

    runPythonDiagnostics(state, '/tmp');

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain('pyright');
    expect(cmd).toContain('--outputjson');
    expect(cmd).toContain('file.py');
    expect(cmd).toContain('file2.py');
  });

  it('runPythonDiagnostics returns formatted diagnostics on pyright output', () => {
    const state = createLspDiagnosticsState();
    trackFileModification(state, 'write', { filePath: '/test/file.py' });
    
    mockExecSync.mockReturnValue(JSON.stringify({
      diagnostics: [
        {
          file: '/test/file.py',
          range: { start: { line: 10 } },
          message: 'Cannot find module "nonexistent"',
          severity: 'error',
        },
      ],
    }));

    const result = runPythonDiagnostics(state, '/tmp');
    expect(result).not.toBeNull();
    expect(result).toContain('Python');
    expect(result).toContain('Cannot find module');
  });
});
