import { LspTransport } from './transport.js';
import { LspClient } from './client.js';
import { getLanguageFromPath, getLspInstallDir, type LspServerConfig } from '../tools/lsp-manager.js';

/**
 * LSP Manager — manages LSP client instances per workspace and language.
 *
 * Features:
 * - Client pooling: one client per workspace::language combination
 * - Idle reaper: kills clients idle for more than 5 minutes
 * - Graceful shutdown: closes all clients on shutdown
 */
export class LspManager {
  private clients = new Map<string, { client: LspClient; lastUsed: number }>();

  /**
   * Get or create an LSP client for the given workspace and server.
   */
  async getClient(workspaceRoot: string, serverId: string): Promise<LspClient> {
    const key = LspManager.getClientKey(workspaceRoot, serverId);

    const existing = this.clients.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    // Find the server command for this language
    const serverPath = await resolveServerPath(serverId);
    if (!serverPath) {
      throw new Error(`No LSP server found for language: ${serverId}. Install one with lsp_install.`);
    }

    // Create transport and client
    const transport = new LspTransport(serverPath.path, serverPath.args);
    transport.start();

    const client = new LspClient(transport);

    try {
      await client.initialize(workspaceRoot);
    } catch (err: any) {
      transport.close();
      throw new Error(`Failed to initialize LSP for ${serverId}: ${err.message}`);
    }

    this.clients.set(key, { client, lastUsed: Date.now() });
    return client;
  }

  /**
   * Release a client (does not close it, just removes from pool).
   */
  releaseClient(key: string): void {
    this.clients.delete(key);
  }

  /**
   * Kill clients that have been idle for more than 5 minutes.
   */
  reapIdleClients(): void {
    const now = Date.now();
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    for (const [key, entry] of this.clients) {
      if (now - entry.lastUsed > IDLE_TIMEOUT) {
        entry.client.close().catch(() => {});
        this.clients.delete(key);
      }
    }
  }

  /**
   * Get the number of active clients.
   */
  getActiveClients(): number {
    return this.clients.size;
  }

  /**
   * Shut down all clients gracefully.
   */
  async shutdownAll(): Promise<void> {
    const shutdowns = [...this.clients.values()].map((entry) =>
      entry.client.close().catch(() => {})
    );
    await Promise.all(shutdowns);
    this.clients.clear();
  }

  /**
   * Generate a unique key for a workspace::server combination.
   */
  static getClientKey(workspaceRoot: string, serverId: string): string {
    return `${workspaceRoot}::${serverId}`;
  }
}

/**
 * Resolved server path info.
 */
interface ResolvedServer {
  path: string;
  args: string[];
}

/**
 * Resolve the LSP server binary path for a given language.
 *
 * Checks:
 * 1. Local install (~/.config/opencode/hive/lsp/bin/)
 * 2. System PATH
 */
async function resolveServerPath(serverId: string): Promise<ResolvedServer | null> {
  const installDir = getLspInstallDir();
  const binDir = `${installDir}/bin`;

  const serverPaths: Record<string, ResolvedServer> = {
    typescript: { path: `${binDir}/typescript-language-server`, args: ['--stdio'] },
    python: { path: 'pyright', args: ['--stdio'] },
    rust: { path: 'rust-analyzer', args: [] },
    go: { path: 'gopls', args: [] },
    java: { path: 'jdtls', args: [] },
    cpp: { path: 'clangd', args: [] },
    c: { path: 'clangd', args: [] },
    csharp: { path: 'omniSharp', args: ['--languageserver', '--hostPID', String(process.pid)] },
    ruby: { path: 'solargraph', args: ['stdio'] },
    php: { path: 'phpactor', args: ['--stdio'] },
    vue: { path: `${binDir}/vue-language-server`, args: ['--stdio'] },
    svelte: { path: `${binDir}/svelte-language-server`, args: ['--stdio'] },
  };

  return serverPaths[serverId] ?? null;
}

/**
 * Get LSP client for a file path (convenience wrapper).
 */
export async function getLspClientForFile(
  filePath: string,
  workspaceRoot: string,
  manager: LspManager
): Promise<{ client: LspClient; language: string } | null> {
  const lang = getLanguageFromPath(filePath);
  if (!lang) return null;

  try {
    const client = await manager.getClient(workspaceRoot, lang);
    return { client, language: lang };
  } catch {
    return null;
  }
}

// Export singleton for convenience
export const lspClientManager = new LspManager();
