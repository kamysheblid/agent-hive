import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Plugin Dependencies that can be auto-installed
 */
interface ToolConfig {
  name: string;
  npmPackage: string;
  installCommand: string[];
  verifyCommand: string;
  description: string;
  required: boolean;
}

const PLUGIN_TOOLS: ToolConfig[] = [
  {
    name: 'btca',
    npmPackage: 'btca-cli',
    installCommand: ['npm', 'install', '-g', 'btca-cli'],
    verifyCommand: 'btca --version',
    description: 'Bluetooth Classic Audio control',
    required: false, // Optional - only if user wants Bluetooth audio
  },
  {
    name: 'dora',
    npmPackage: '@butttons/dora',
    installCommand: ['npm', 'install', '-g', '@butttons/dora'],
    verifyCommand: 'dora --version',
    description: 'SCIP-based code navigation',
    required: false,
  },
  {
    name: 'auto-cr',
    npmPackage: 'auto-cr-cmd',
    installCommand: ['npm', 'install', '-g', 'auto-cr-cmd'],
    verifyCommand: 'auto-cr-cmd --version',
    description: 'SWC-based automated code review',
    required: false,
  },
  {
    name: 'scip-typescript',
    npmPackage: '@sourcegraph/scip-typescript',
    installCommand: ['npm', 'install', '-g', '@sourcegraph/scip-typescript'],
    verifyCommand: 'scip-typescript --version',
    description: 'TypeScript SCIP indexer (for dora)',
    required: false,
  },
  {
    name: 'typescript-language-server',
    npmPackage: 'typescript-language-server',
    installCommand: ['npm', 'install', '-g', 'typescript-language-server', 'typescript'],
    verifyCommand: 'typescript-language-server --version',
    description: 'TypeScript/JavaScript LSP server',
    required: false,
  },
  {
    name: 'pyright',
    npmPackage: 'pyright',
    installCommand: ['pip', 'install', 'pyright'],
    verifyCommand: 'pyright --version',
    description: 'Python LSP server',
    required: false,
  },
];

/**
 * Dependency Installer for plugin tools
 */
export class DependencyInstaller {
  private installDir: string;
  private cache: Map<string, { installed: boolean; checked: number }> = new Map();
  private cacheTimeout = 60000; // 1 minute cache

  constructor(installDir?: string) {
    this.installDir = installDir || path.join(os.homedir(), '.local');
  }

  /**
   * Get the bin directory for installed tools
   */
  getBinDir(): string {
    return path.join(this.installDir, 'bin');
  }

  /**
   * Check if a command exists
   */
  commandExists(cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify a tool is installed and working
   */
  verifyTool(config: ToolConfig): boolean {
    try {
      execSync(config.verifyCommand, { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install a single tool
   */
  async install(config: ToolConfig): Promise<{ success: boolean; output?: string; error?: string }> {
    // Skip if already installed
    if (this.verifyTool(config)) {
      console.log(`[dep-installer] ✓ ${config.name} already installed`);
      return { success: true, output: `${config.name} already available` };
    }

    console.log(`[dep-installer] Installing ${config.name}...`);
    
    try {
      const [cmd, ...args] = config.installCommand;
      const fullCmd = `${cmd} ${args.join(' ')}`;
      
      execSync(fullCmd, {
        stdio: 'pipe',
        timeout: 120000, // 2 minutes
        env: {
          ...process.env,
          // Set prefix to installDir if using npm
          ...(cmd === 'npm' ? { npm_config_prefix: this.installDir } : {}),
        },
      });

      const verified = this.verifyTool(config);
      if (verified) {
        console.log(`[dep-installer] ✓ ${config.name} installed successfully`);
        this.cache.set(config.name, { installed: true, checked: Date.now() });
        return { success: true, output: `${config.name} installed and verified` };
      } else {
        return { success: false, error: 'Installation completed but verification failed' };
      }
    } catch (error: any) {
      // Log error but don't fail - tool might still work via npx
      console.warn(`[dep-installer] ✗ ${config.name} installation failed: ${error.message}`);
      console.log(`[dep-installer] Tool will be available via npx if needed`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if a tool is installed (with caching)
   */
  isInstalled(toolName: string): boolean {
    const cached = this.cache.get(toolName);
    
    if (cached && Date.now() - cached.checked < this.cacheTimeout) {
      return cached.installed;
    }

    const config = PLUGIN_TOOLS.find(t => t.name === toolName);
    if (!config) return false;

    const installed = this.verifyTool(config);
    this.cache.set(toolName, { installed, checked: Date.now() });
    return installed;
  }

  /**
   * Get status of all tools
   */
  getStatus(): Array<{ name: string; installed: boolean; description: string; required: boolean }> {
    return PLUGIN_TOOLS.map(config => ({
      name: config.name,
      installed: this.isInstalled(config.name),
      description: config.description,
      required: config.required,
    }));
  }

  /**
   * Ensure all required tools are installed
   */
  async ensureRequired(): Promise<{
    installed: string[];
    missing: string[];
    errors: Record<string, string>;
  }> {
    const installed: string[] = [];
    const missing: string[] = [];
    const errors: Record<string, string> = {};

    for (const config of PLUGIN_TOOLS) {
      if (config.required && !this.isInstalled(config.name)) {
        const result = await this.install(config);
        if (result.success) {
          installed.push(config.name);
        } else {
          missing.push(config.name);
          errors[config.name] = result.error || 'Installation failed';
        }
      }
    }

    return { installed, missing, errors };
  }

  /**
   * Install all optional tools (for full functionality)
   */
  async installAll(): Promise<{
    success: string[];
    failed: Record<string, string>;
  }> {
    const success: string[] = [];
    const failed: Record<string, string> = {};

    for (const config of PLUGIN_TOOLS) {
      if (!this.isInstalled(config.name)) {
        const result = await this.install(config);
        if (result.success) {
          success.push(config.name);
        } else {
          failed[config.name] = result.error || 'Installation failed';
        }
      } else {
        success.push(config.name); // Already installed
      }
    }

    return { success, failed };
  }

  /**
   * Install specific tool by name
   */
  async installTool(toolName: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const config = PLUGIN_TOOLS.find(t => t.name === toolName);
    
    if (!config) {
      return { success: false, error: `Unknown tool: ${toolName}. Available: ${PLUGIN_TOOLS.map(t => t.name).join(', ')}` };
    }

    if (this.isInstalled(toolName)) {
      return { success: true, output: `${toolName} is already installed` };
    }

    return this.install(config);
  }
}

// Export singleton
export const dependencyInstaller = new DependencyInstaller();

// Helper functions for quick access
export async function ensurePluginDeps(): Promise<void> {
  // Run in background, don't block
  dependencyInstaller.ensureRequired().catch(console.error);
}

export function getInstalledTools(): string[] {
  return dependencyInstaller.getStatus()
    .filter(t => t.installed)
    .map(t => t.name);
}
