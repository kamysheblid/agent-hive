import { describe, expect, it } from 'bun:test';
import {
  createLspDiagnosticsState,
  trackFileModification,
  runTypeScriptDiagnostics,
  resetDiagnostics,
} from './lsp-diagnostics.js';

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
