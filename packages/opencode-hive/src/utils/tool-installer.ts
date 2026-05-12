/**
 * Tool Auto-Installer
 * Auto-installs hive dependencies (Agent Tools + CLI Tools) on plugin load.
 * All tools are npm packages installed into ~/.config/opencode/hive/packages/
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const HIVE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hive');
const PACKAGES_DIR = path.join(HIVE_DIR, 'packages');
const NODE_MODULES_DIR = path.join(PACKAGES_DIR, 'node_modules');
const BIN_DIR = path.join(HIVE_DIR, 'bin');

interface ToolEntry {
  name: string;
  category: 'agent' | 'cli';
  binaries?: string[];
}

const TOOLS: ToolEntry[] = [
  { name: '@sparkleideas/agent-booster', category: 'agent' },
  { name: '@sparkleideas/memory', category: 'agent' },
  { name: '@butttons/dora', category: 'cli', binaries: ['dora'] },
  { name: 'auto-cr-cmd', category: 'cli', binaries: ['auto-cr-cmd'] },
  { name: 'btca-cli', category: 'cli', binaries: ['btca'] },
];

export function getHiveNodeModulesPath(): string {
  return NODE_MODULES_DIR;
}

export function getHiveBinPath(): string {
  return BIN_DIR;
}

/** Check if an npm module is resolvable from the hive packages or normal require. */
function isModuleResolvable(name: string): boolean {
  const hivePath = path.join(NODE_MODULES_DIR, name);
  if (fs.existsSync(hivePath)) return true;
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

/** Check if a CLI binary is on PATH or in the hive bin dir. */
function isCliAvailable(binary: string): boolean {
  if (fs.existsSync(path.join(BIN_DIR, binary))) return true;
  try {
    execSync(`which ${binary} 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function isToolAvailable(name: string): boolean {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return isModuleResolvable(name) || isCliAvailable(name);
  if (tool.category === 'agent') return isModuleResolvable(tool.name);
  return (tool.binaries ?? []).some(b => isCliAvailable(b));
}

/**
 * Auto-install all tools into the hive packages directory.
 * Agent Tools land in node_modules for require() resolution.
 * CLI Tools get binaries symlinked to hive/bin/ for PATH access.
 */
export async function ensureToolsInstalled(): Promise<{ installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];

  const toInstall = TOOLS.filter(t => !isToolAvailable(t.name));
  if (toInstall.length === 0) {
    return { installed: [], failed: [] };
  }

  console.log(`[hive:installer] Auto-installing ${toInstall.length} tool(s): ${toInstall.map(t => t.name).join(', ')}`);

  fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const packageNames = toInstall.map(t => t.name);
  try {
    execSync(
      `npm install --prefix "${PACKAGES_DIR}" --no-package-lock --no-save ${packageNames.join(' ')} 2>&1`,
      { stdio: 'pipe', timeout: 120000 },
    );

    for (const tool of toInstall) {
      if (tool.category === 'cli' && tool.binaries) {
        for (const bin of tool.binaries) {
          const source = path.join(NODE_MODULES_DIR, '.bin', bin);
          const target = path.join(BIN_DIR, bin);
          if (fs.existsSync(source) && !fs.existsSync(target)) {
            try {
              fs.symlinkSync(source, target);
            } catch {
              fs.copyFileSync(source, target);
              fs.chmodSync(target, 0o755);
            }
          }
        }
      }
    }

    const names = toInstall.map(t => t.name);
    console.log(`[hive:installer] Installed: ${names.join(', ')}`);
    installed.push(...names);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[hive:installer] Install failed: ${message}`);
    console.warn('[hive:installer] Tools will fall back to graceful degradation');
    failed.push(...packageNames);
  }

  return { installed, failed };
}
