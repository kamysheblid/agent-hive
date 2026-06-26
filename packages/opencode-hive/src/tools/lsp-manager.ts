import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * LSP Server Database with installation commands and fallbacks
 */
interface LspServerConfig {
  extensions: string[];
  primary: {
    command: string;
    args: string[];
    verifyCommand?: string;
  };
  alternatives: Array<{
    command: string;
    args: string[];
    verifyCommand?: string;
  }>;
}

/**
 * Get the local LSP install directory (~/.config/opencode/hive/lsp)
 */
export function getLspInstallDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'hive', 'lsp');
}

const LSP_DATABASE: Record<string, LspServerConfig> = {
  typescript: {
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
    primary: {
      command: 'npm',
      args: ['install', '--prefix', getLspInstallDir(), 'typescript-language-server', 'typescript'],
      verifyCommand: `${path.join(getLspInstallDir(), 'bin')}/typescript-language-server --version`,
    },
    alternatives: [
      {
        command: 'npm',
        args: ['install', '--prefix', getLspInstallDir(), '@volarjs/typescript-language-server'],
        verifyCommand: `${path.join(getLspInstallDir(), 'bin')}/volar-server --version`,
      },
    ],
  },
  python: {
    extensions: ['py', 'pyw', 'pyi'],
    primary: {
      command: 'uv',
      args: ['pip', 'install', '--user', 'pyright'],
      verifyCommand: 'pyright --version',
    },
    alternatives: [
      {
        command: 'pip',
        args: ['install', '--user', 'ruff-lsp'],
        verifyCommand: 'ruff-lsp --version',
      },
      {
        command: 'pip',
        args: ['install', '--user', 'jedi-language-server'],
        verifyCommand: 'jedi-language-server --version',
      },
    ],
  },
  rust: {
    extensions: ['rs'],
    primary: {
      command: 'rustup',
      args: ['component', 'add', 'rust-analyzer'],
      verifyCommand: 'rust-analyzer --version',
    },
    alternatives: [],
  },
  go: {
    extensions: ['go'],
    primary: {
      command: 'go',
      args: ['install', 'golang.org/x/tools/gopls@latest'],
      verifyCommand: 'gopls version',
    },
    alternatives: [],
  },
  java: {
    extensions: ['java'],
    primary: {
      command: 'sdk',
      args: ['install', 'java', '21.0.3-tem'],
      verifyCommand: 'jdtls --version',
    },
    alternatives: [],
  },
  cpp: {
    extensions: ['cpp', 'cc', 'cxx', 'c', 'h', 'hpp', 'hh'],
    primary: {
      command: 'apt',
      args: ['install', 'clangd'],
      verifyCommand: 'clangd --version',
    },
    alternatives: [
      {
        command: 'apt',
        args: ['install', 'ccls'],
        verifyCommand: 'ccls --version',
      },
    ],
  },
  csharp: {
    extensions: ['cs'],
    primary: {
      command: 'dotnet',
      args: ['tool', 'install', '--global', 'OmniSharp'],
      verifyCommand: 'omniSharp --version',
    },
    alternatives: [],
  },
  ruby: {
    extensions: ['rb'],
    primary: {
      command: 'gem',
      args: ['install', 'solargraph'],
      verifyCommand: 'solargraph --version',
    },
    alternatives: [],
  },
  php: {
    extensions: ['php'],
    primary: {
      command: 'composer',
      args: ['global', 'require', 'phpactor/phpactor'],
      verifyCommand: 'phpactor --version',
    },
    alternatives: [],
  },
  vue: {
    extensions: ['vue'],
    primary: {
      command: 'npm',
      args: ['install', '--prefix', getLspInstallDir(), 'volar'],
      verifyCommand: `${path.join(getLspInstallDir(), 'bin')}/volar-server --version`,
    },
    alternatives: [],
  },
  svelte: {
    extensions: ['svelte'],
    primary: {
      command: 'npm',
      args: ['install', '--prefix', getLspInstallDir(), 'svelte-language-server'],
      verifyCommand: `${path.join(getLspInstallDir(), 'bin')}/svelte-language-server --version`,
    },
    alternatives: [],
  },
};

/**
 * Get language from file extension
 */
export function getLanguageFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  
  for (const [lang, config] of Object.entries(LSP_DATABASE)) {
    if (config.extensions.includes(ext)) {
      return lang;
    }
  }
  
  return null;
}

/**
 * Check if a command exists
 */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if LSP server is installed and working
 */
async function checkLspServer(config: LspServerConfig['primary']): Promise<boolean> {
  const cmd = config.verifyCommand || `${config.command} --version`;
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a local install exists for the given language
 */
export function checkLocalInstall(language: string): boolean {
  const config = LSP_DATABASE[language];
  if (!config) return false;
  
  const verifyCmd = config.primary.verifyCommand;
  if (!verifyCmd) return false;
  
  // Check if the local binary exists
  try {
    execSync(verifyCmd, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install LSP server with fallbacks
 */
export async function ensureLspInstalled(language: string): Promise<{
  success: boolean;
  installed: string | null;
  error?: string;
}> {
  const config = LSP_DATABASE[language];
  
  if (!config) {
    return {
      success: false,
      installed: null,
      error: `No LSP configuration for language: ${language}`,
    };
  }

  // Try primary first
  if (await checkLspServer(config.primary)) {
    return { success: true, installed: config.primary.command };
  }

  // Try to install primary
  try {
    console.log(`[lsp] Installing ${language} LSP: ${config.primary.command} ${config.primary.args.join(' ')}`);
    execSync(`${config.primary.command} ${config.primary.args.join(' ')}`, {
      stdio: 'inherit',
      timeout: 120000, // 2 minutes
    });
    
    if (await checkLspServer(config.primary)) {
      return { success: true, installed: config.primary.command };
    }
  } catch (error: any) {
    console.warn(`[lsp] Primary installation failed: ${error.message}`);
  }

  // Try alternatives
  for (const alt of config.alternatives) {
    try {
      console.log(`[lsp] Trying alternative: ${alt.command} ${alt.args.join(' ')}`);
      execSync(`${alt.command} ${alt.args.join(' ')}`, {
        stdio: 'inherit',
        timeout: 120000,
      });
      
      if (await checkLspServer(alt)) {
        return { success: true, installed: alt.command };
      }
    } catch (error: any) {
      console.warn(`[lsp] Alternative installation failed: ${error.message}`);
    }
  }

  return {
    success: false,
    installed: null,
    error: `Failed to install LSP for ${language}. Tried: ${config.primary.command} and ${config.alternatives.map(a => a.command).join(', ')}`,
  };
}

/**
 * LSP Status Report
 */
export interface LspStatus {
  language: string;
  installed: boolean;
  primary: string | null;
  alternatives: string[];
  canInstall: boolean;
  localInstall?: boolean;
}

export async function getLspStatus(filePath?: string): Promise<LspStatus | LspStatus[]> {
  if (filePath) {
    const lang = getLanguageFromPath(filePath);
    if (!lang) {
      return {
        language: 'unknown',
        installed: false,
        primary: null,
        alternatives: [],
        canInstall: false,
      };
    }
    
    const config = LSP_DATABASE[lang];
    return {
      language: lang,
      installed: await checkLspServer(config.primary),
      primary: config.primary.command,
      alternatives: config.alternatives.map(a => a.command),
      canInstall: config.alternatives.length > 0 || true,
      localInstall: checkLocalInstall(lang),
    };
  }

  // Return status for all languages
  const statuses: LspStatus[] = [];
  for (const lang of Object.keys(LSP_DATABASE)) {
    const config = LSP_DATABASE[lang];
    statuses.push({
      language: lang,
      installed: await checkLspServer(config.primary),
      primary: config.primary.command,
      alternatives: config.alternatives.map(a => a.command),
      canInstall: config.alternatives.length > 0 || true,
      localInstall: checkLocalInstall(lang),
    });
  }
  return statuses;
}

/**
 * LSP Manager Class for actual LSP communication
 */
export class LspManager {
  private connections: Map<string, any> = new Map();
  
  /**
   * Check LSP status and optionally auto-install
   */
  async checkAndInstall(filePath: string): Promise<{
    language: string;
    ready: boolean;
    installed: boolean;
    message: string;
  }> {
    const lang = getLanguageFromPath(filePath);
    
    if (!lang) {
      return {
        language: 'unknown',
        ready: false,
        installed: false,
        message: `Unsupported file type. LSP not available.`,
      };
    }

    const config = LSP_DATABASE[lang];
    if (!config) {
      return {
        language: lang,
        ready: false,
        installed: false,
        message: `No LSP configuration for ${lang}.`,
      };
    }

    const isInstalled = await checkLspServer(config.primary);
    
    if (isInstalled) {
      return {
        language: lang,
        ready: true,
        installed: true,
        message: `${lang} LSP ready (${config.primary.command})`,
      };
    }

    // Try to install
    const result = await ensureLspInstalled(lang);
    
    return {
      language: lang,
      ready: result.success,
      installed: result.success,
      message: result.success 
        ? `${lang} LSP installed successfully` 
        : result.error || 'Installation failed',
    };
  }

  /**
   * Get available LSP languages
   */
  getAvailableLanguages(): string[] {
    return Object.keys(LSP_DATABASE);
  }

  /**
   * Get LSP info for a file
   */
  getLspInfo(filePath: string): {
    language: string;
    extensions: string[];
    primaryCommand: string;
    alternativeCommands: string[];
  } | null {
    const lang = getLanguageFromPath(filePath);
    if (!lang) return null;
    
    const config = LSP_DATABASE[lang];
    return {
      language: lang,
      extensions: config.extensions,
      primaryCommand: config.primary.command,
      alternativeCommands: config.alternatives.map(a => a.command),
    };
  }
}

// Export singleton for convenience
export const lspManager = new LspManager();
