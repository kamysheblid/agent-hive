import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Plugin Dependencies that can be auto-installed
 * Uses npx to avoid npm global install conflicts
 */
interface ToolConfig {
  name: string;
  npxPackage: string;
  verifyCommand: string;
  description: string;
}

const PLUGIN_TOOLS: ToolConfig[] = [
  {
    name: 'btca',
    npxPackage: 'btca-cli',
    verifyCommand: 'btca --version',
    description: 'Bluetooth Classic Audio control',
  },
  {
    name: 'dora',
    npxPackage: '@butttons/dora',
    verifyCommand: 'dora --version',
    description: 'SCIP-based code navigation',
  },
  {
    name: 'auto-cr',
    npxPackage: 'auto-cr-cmd',
    verifyCommand: 'auto-cr-cmd --version',
    description: 'SWC-based automated code review',
  },
  {
    name: 'scip-typescript',
    npxPackage: '@sourcegraph/scip-typescript',
    verifyCommand: 'scip-typescript --version',
    description: 'TypeScript SCIP indexer (for dora)',
  },
  {
    name: 'typescript-language-server',
    npxPackage: 'typescript-language-server',
    verifyCommand: 'typescript-language-server --version',
    description: 'TypeScript/JavaScript LSP server',
  },
  {
    name: 'pyright',
    npxPackage: 'pyright',
    verifyCommand: 'pyright --version',
    description: 'Python LSP server',
  },
];

/**
 * Dependency Installer for plugin tools
 * Uses npx to avoid npm global install conflicts
 */
export class DependencyInstaller {
  private cache: Map<string, { installed: boolean; checked: number }> = new Map();
  private cacheTimeout = 60000; // 1 minute cache

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
   * Install a single tool using npx (no global install)
   */
  async install(config: ToolConfig): Promise<{ success: boolean; output?: string; error?: string }> {
    // Skip if already installed
    if (this.verifyTool(config)) {
      console.log(`[dep-installer] ✓ ${config.name} already installed`);
      return { success: true, output: `${config.name} already available` };
    }

    console.log(`[dep-installer] Checking ${config.name} via npx...`);
    
    try {
      // Try npx first (doesn't require global install)
      const result = execSync(`npx -y ${config.npxPackage} --version`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      
      const version = result.toString().trim();
      console.log(`[dep-installer] ✓ ${config.name} available via npx (${version})`);
      this.cache.set(config.name, { installed: true, checked: Date.now() });
      return { success: true, output: `${config.name} available via npx (${version})` };
    } catch (error: any) {
      // npx failed, try global install as fallback
      console.log(`[dep-installer] npx failed, trying global install...`);
      
      try {
        execSync(`npm install -g ${config.npxPackage}`, {
          stdio: 'pipe',
          timeout: 120000,
        });
        
        if (this.verifyTool(config)) {
          console.log(`[dep-installer] ✓ ${config.name} installed globally`);
          this.cache.set(config.name, { installed: true, checked: Date.now() });
          return { success: true, output: `${config.name} installed globally` };
        }
      } catch (installError: any) {
        console.warn(`[dep-installer] Global install also failed: ${installError.message}`);
      }
      
      return { 
        success: false, 
        error: `Failed to install ${config.name}. Tool may not be critical.` 
      };
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
  getStatus(): Array<{ name: string; installed: boolean; description: string; viaNpx: boolean }> {
    return PLUGIN_TOOLS.map(config => ({
      name: config.name,
      installed: this.isInstalled(config.name),
      description: config.description,
      viaNpx: true, // Tools available via npx
    }));
  }

  /**
   * Ensure all tools are available (check via npx, don't force install)
   */
  async ensureAvailable(): Promise<{
    available: string[];
    unavailable: string[];
  }> {
    const available: string[] = [];
    const unavailable: string[] = [];

    for (const config of PLUGIN_TOOLS) {
      if (this.isInstalled(config.name)) {
        available.push(config.name);
      } else {
        // Try npx to see if it works
        try {
          execSync(`npx -y ${config.npxPackage} --version`, {
            stdio: 'ignore',
            timeout: 10000,
          });
          available.push(config.name);
        } catch {
          unavailable.push(config.name);
        }
      }
    }

    return { available, unavailable };
  }
}

// Export singleton
export const dependencyInstaller = new DependencyInstaller();

// Helper functions for quick access
export async function checkPluginDeps(): Promise<void> {
  const status = await dependencyInstaller.ensureAvailable();
  if (status.unavailable.length > 0) {
    console.log(`[dep-installer] Tools not available via npx: ${status.unavailable.join(', ')}`);
    console.log(`[dep-installer] These tools will be installed on-demand when needed.`);
  }
}
