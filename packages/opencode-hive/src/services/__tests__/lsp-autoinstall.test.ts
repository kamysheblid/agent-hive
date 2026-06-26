import { describe, it, expect, vi, beforeEach } from 'bun:test';
import * as os from 'os';
import * as path from 'path';

// Mock child_process before importing the module under test
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { ensureLspServers, getLspInstallDir, prependLspToPath } from '../lsp-autoinstall.js';

describe('ensureLspServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip all servers when already installed', async () => {
    // All check commands succeed
    mockExecSync.mockImplementation(() => '');

    const results = await ensureLspServers();

    expect(results).toHaveLength(4);
    expect(results.every(r => r.installed === true && r.skipped === true)).toBe(true);
    // Should only run check commands (4) + no install commands
    expect(mockExecSync).toHaveBeenCalledTimes(4);
  });

  it('should install servers that are not installed', async () => {
    // First call (check) throws, second call (install) succeeds
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('not found'); })  // TS check fails
      .mockImplementationOnce(() => '')                                   // TS install succeeds
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Python check fails
      .mockImplementationOnce(() => '')                                   // Python install succeeds
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Go check fails
      .mockImplementationOnce(() => '')                                   // Go install succeeds
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Rust check fails
      .mockImplementationOnce(() => '')                                   // Rust install succeeds

    const results = await ensureLspServers();

    expect(results).toHaveLength(4);
    expect(results.every(r => r.installed === true && r.skipped === false)).toBe(true);
    // 4 checks + 4 installs = 8 calls
    expect(mockExecSync).toHaveBeenCalledTimes(8);
  });

  it('should handle installation failures gracefully', async () => {
    // All checks fail, installs also fail
    mockExecSync.mockImplementation(() => { throw new Error('command not found'); });

    const results = await ensureLspServers();

    expect(results).toHaveLength(4);
    expect(results.every(r => r.installed === false && r.skipped === false)).toBe(true);
    // 4 checks + 4 primary installs + 1 fallback (Python) = 9 calls
    expect(mockExecSync).toHaveBeenCalledTimes(9);
  });

  it('should handle mixed states', async () => {
    // TS: already installed (check passes)
    mockExecSync
      .mockImplementationOnce(() => '')                                   // TS check succeeds
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Python check fails
      .mockImplementationOnce(() => '')                                   // Python install succeeds
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Go check fails
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Go install fails
      .mockImplementationOnce(() => { throw new Error('not found'); })  // Rust check fails
      .mockImplementationOnce(() => '')                                   // Rust install succeeds

    const results = await ensureLspServers();

    expect(results).toHaveLength(4);
    
    expect(results[0]).toMatchObject({ name: 'TypeScript', installed: true, skipped: true });
    expect(results[1]).toMatchObject({ name: 'Python', installed: true, skipped: false });
    expect(results[2]).toMatchObject({ name: 'Go', installed: false, skipped: false });
    expect(results[3]).toMatchObject({ name: 'Rust', installed: true, skipped: false });
  });

  it('should not crash when execSync throws unexpected error', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('EPERM: operation not permitted'); });

    const results = await ensureLspServers();

    expect(results).toHaveLength(4);
    expect(results.every(r => r.installed === false)).toBe(true);
  });
});

describe('LSP local install path', () => {
  it('getLspInstallDir returns ~/.config/opencode/hive/lsp', () => {
    const installDir = getLspInstallDir();
    const expected = path.join(os.homedir(), '.config', 'opencode', 'hive', 'lsp');
    expect(installDir).toBe(expected);
  });

  it('TypeScript uses local prefix install (not global -g)', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    await ensureLspServers();

    // Find the TypeScript install command (contains 'npm install')
    const installCalls = mockExecSync.mock.calls
      .filter((call: any[]) => typeof call[0] === 'string' && call[0].includes('npm install'));
    
    expect(installCalls.length).toBeGreaterThan(0);
    
    // Should use --prefix (local install) instead of -g (global)
    const installCmd = installCalls[0][0] as string;
    expect(installCmd).toContain('--prefix');
    expect(installCmd).not.toContain('-g');
  });

  it('prependLspToPath adds local bin to PATH', () => {
    const originalPath = process.env.PATH;
    try {
      prependLspToPath();
      const installDir = getLspInstallDir();
      expect(process.env.PATH).toContain(path.join(installDir, 'bin'));
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
