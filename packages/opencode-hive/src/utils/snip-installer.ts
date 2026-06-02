/**
 * Snip Auto-Installer
 * Downloads snip binary from https://github.com/edouard-claude/snip
 * snip reduces LLM token usage by 60-90% by filtering shell output.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const SNIP_REPO = 'edouard-claude/snip';
const FALLBACK_VERSION = '0.15.0';
const BINARY_NAME = process.platform === 'win32' ? 'snip.exe' : 'snip';

const OS_MAP: Record<string, string> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
};

const ARCH_MAP: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
};

function getInstallDir(): string {
  return path.join(process.env.HOME || '/root', '.config', 'opencode', 'hive', 'bin');
}

export function getSnipBinaryPath(): string {
  return path.join(getInstallDir(), BINARY_NAME);
}

export function isSnipInstalled(): boolean {
  return fs.existsSync(getSnipBinaryPath());
}

/**
 * Check if snip is available on PATH (e.g., globally installed).
 */
export function isSnipOnPath(): boolean {
  try {
    execSync('which snip 2>/dev/null', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if snip is available (either auto-installed or on PATH).
 */
export function isSnipAvailable(): boolean {
  return isSnipInstalled() || isSnipOnPath();
}

async function getLatestVersion(): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${SNIP_REPO}/releases/latest`,
    { headers: { 'Accept': 'application/vnd.github.v3+json' } },
  );
  if (!response.ok) {
    throw new Error(`GitHub API responded with ${response.status}`);
  }
  const data = await response.json() as { tag_name: string };
  return data.tag_name.replace(/^v/, '');
}

/**
 * Ensure snip binary is installed.
 * Downloads from GitHub releases if not present.
 * Falls back to 'snip' (PATH lookup) if installation fails.
 */
export async function ensureSnipInstalled(): Promise<string> {
  const binaryPath = getSnipBinaryPath();

  if (isSnipInstalled()) {
    return binaryPath;
  }

  console.log('[hive:snip] Auto-installing snip binary for 60-90% token reduction...');

  const os = OS_MAP[process.platform] || 'linux';
  const arch = ARCH_MAP[process.arch] || 'amd64';

  let version: string;
  try {
    version = await getLatestVersion();
  } catch {
    version = FALLBACK_VERSION;
  }

  const url = `https://github.com/${SNIP_REPO}/releases/download/v${version}/snip_${version}_${os}_${arch}.tar.gz`;
  const installDir = getInstallDir();
  const tmpDir = path.join(installDir, '.snip-tmp');

  try {
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    console.log(`[hive:snip] Downloading ${os}/${arch} v${version}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(tmpDir, 'snip.tar.gz'), buffer);

    execSync(`tar xzf "${path.join(tmpDir, 'snip.tar.gz')}" -C "${tmpDir}"`, { stdio: 'pipe' });

    const extractedBin = path.join(tmpDir, BINARY_NAME);
    if (!fs.existsSync(extractedBin)) {
      throw new Error('Binary not found in extracted archive');
    }

    fs.renameSync(extractedBin, binaryPath);
    fs.chmodSync(binaryPath, 0o755);
    console.log(`[hive:snip] Installed to ${binaryPath}`);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[hive:snip] Auto-install failed: ${message}`);
    
    // Fallback: check if snip is on PATH (globally installed)
    if (isSnipOnPath()) {
      console.log('[hive:snip] Found snip on PATH, will use it');
      return 'snip';  // let PATH resolve it
    }
    
    console.warn('[hive:snip] Commands will pass through without filtering - no impact on functionality');
    return '';  // snip not available
  }

  return binaryPath;
}
