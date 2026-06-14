import { execSync } from 'child_process';

/**
 * LSP server definition for proactive installation.
 */
interface LspServerDef {
  name: string;
  checkCommand: string;
  installCommand: string;
  fallbackCommand?: string;
}

const LSP_SERVERS: LspServerDef[] = [
  {
    name: 'TypeScript',
    checkCommand: 'typescript-language-server --version',
    installCommand: 'npm install -g typescript-language-server',
  },
  {
    name: 'Python',
    checkCommand: 'pyright --version',
    installCommand: 'uv pip install pyright',
    fallbackCommand: 'pip install pyright',
  },
  {
    name: 'Go',
    checkCommand: 'gopls version',
    installCommand: 'go install golang.org/x/tools/gopls@latest',
  },
  {
    name: 'Rust',
    checkCommand: 'rust-analyzer --version',
    installCommand: 'rustup component add rust-analyzer',
  },
];

export interface LspServerResult {
  name: string;
  installed: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Check if an LSP server is already installed by running its version command.
 */
function isInstalled(command: string): boolean {
  try {
    execSync(command, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a single LSP server, with optional fallback.
 */
function installServer(def: LspServerDef): boolean {
  const tryInstall = (cmd: string, label: string): boolean => {
    try {
      console.log(`[lsp-autoinstall] Installing ${def.name}: ${cmd}`);
      execSync(cmd, { stdio: 'inherit', timeout: 120000 });
      return true;
    } catch (error: any) {
      console.warn(`[lsp-autoinstall] ${label} failed for ${def.name}: ${error.message}`);
      return false;
    }
  };

  if (tryInstall(def.installCommand, 'Primary install')) {
    return true;
  }

  if (def.fallbackCommand && tryInstall(def.fallbackCommand, 'Fallback install')) {
    return true;
  }

  return false;
}

/**
 * Proactively check and install LSP servers at startup.
 * Fire-and-forget: callers can await or not.
 * Never throws — all errors are caught and logged.
 */
export async function ensureLspServers(): Promise<LspServerResult[]> {
  const results: LspServerResult[] = [];

  for (const server of LSP_SERVERS) {
    try {
      if (isInstalled(server.checkCommand)) {
        console.log(`[lsp-autoinstall] ${server.name} already installed, skipping`);
        results.push({ name: server.name, installed: true, skipped: true });
        continue;
      }

      const success = installServer(server);
      results.push({
        name: server.name,
        installed: success,
        skipped: false,
        error: success ? undefined : `${server.name} installation failed after all attempts`,
      });
    } catch (error: any) {
      console.warn(`[lsp-autoinstall] Unexpected error checking ${server.name}: ${error.message}`);
      results.push({
        name: server.name,
        installed: false,
        skipped: false,
        error: error.message,
      });
    }
  }

  const ready = results.filter(r => r.installed).length;
  console.log(`[lsp-autoinstall] Complete: ${ready}/${results.length} servers ready`);
  return results;
}
