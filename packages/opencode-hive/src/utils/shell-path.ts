/**
 * Shell PATH Manager
 * Automatically adds hive bin directory to shell config files.
 * Detects shell type and finds the appropriate config file.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HIVE_DIR = path.join(os.homedir(), '.config', 'opencode', 'hive');
const BIN_DIR = path.join(HIVE_DIR, 'bin');

const PATH_ENTRY = 'export PATH="/root/.config/opencode/hive/bin:$PATH"';

interface ShellConfig {
  /** Shell name (bash, zsh, fish, etc.) */
  shell: string;
  /** Config file path */
  configPath: string;
  /** PATH entry format for this shell */
  pathEntry: string;
  /** Check if PATH already exists in config */
  checkExists: (content: string) => boolean;
}

/**
 * Detect available shell configs on the system.
 * Returns configs in priority order (most specific first).
 */
function detectShellConfigs(): ShellConfig[] {
  const home = os.homedir();
  const configs: ShellConfig[] = [];

  // Bash
  const bashrc = path.join(home, '.bashrc');
  if (fileExists(bashrc)) {
    configs.push({
      shell: 'bash',
      configPath: bashrc,
      pathEntry: PATH_ENTRY,
      checkExists: (content) => content.includes('opencode/hive/bin'),
    });
  }

  // Zsh
  const zshrc = path.join(home, '.zshrc');
  if (fileExists(zshrc)) {
    configs.push({
      shell: 'zsh',
      configPath: zshrc,
      pathEntry: PATH_ENTRY,
      checkExists: (content) => content.includes('opencode/hive/bin'),
    });
  }

  // Fish (different syntax)
  const fishConfig = path.join(home, '.config', 'fish', 'config.fish');
  if (fileExists(fishConfig)) {
    configs.push({
      shell: 'fish',
      configPath: fishConfig,
      pathEntry: `set -gx PATH ${BIN_DIR} $PATH`,
      checkExists: (content) => content.includes('opencode/hive/bin'),
    });
  }

  // POSIX profile (fallback for login shells)
  const profile = path.join(home, '.profile');
  if (fileExists(profile)) {
    configs.push({
      shell: 'sh',
      configPath: profile,
      pathEntry: PATH_ENTRY,
      checkExists: (content) => content.includes('opencode/hive/bin'),
    });
  }

  return configs;
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add hive bin to PATH in all detected shell configs.
 * Skips if already present.
 * 
 * @returns Summary of what was done
 */
export function ensureHivePathInShellConfig(): {
  added: string[];
  alreadyPresent: string[];
  errors: string[];
} {
  const result = { added: [] as string[], alreadyPresent: [] as string[], errors: [] as string[] };
  const configs = detectShellConfigs();

  if (configs.length === 0) {
    // No shell configs found, create .bashrc as fallback
    const bashrc = path.join(os.homedir(), '.bashrc');
    try {
      fs.writeFileSync(bashrc, `# Hive PATH\n${PATH_ENTRY}\n`, { flag: 'a' });
      result.added.push(bashrc);
    } catch (error) {
      result.errors.push(`Failed to create ${bashrc}: ${error}`);
    }
    return result;
  }

  for (const config of configs) {
    try {
      const content = fs.readFileSync(config.configPath, 'utf-8');
      
      if (config.checkExists(content)) {
        result.alreadyPresent.push(config.configPath);
        continue;
      }

      // Append PATH entry
      const separator = content.endsWith('\n') ? '' : '\n';
      const entry = `${separator}\n# Hive PATH\n${config.pathEntry}\n`;
      fs.appendFileSync(config.configPath, entry);
      result.added.push(config.configPath);
    } catch (error) {
      result.errors.push(`Failed to update ${config.configPath}: ${error}`);
    }
  }

  return result;
}

/**
 * Check if hive bin is already in the current process PATH.
 */
export function isHivePathInEnv(): boolean {
  const pathEnv = process.env.PATH || '';
  return pathEnv.includes(BIN_DIR);
}

/**
 * Get the hive bin path for programmatic use.
 */
export function getHiveBinPath(): string {
  return BIN_DIR;
}
