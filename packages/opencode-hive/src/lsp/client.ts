import { LspTransport } from './transport.js';

/**
 * LSP protocol types
 */

export interface Location {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface Hover {
  contents: string | { kind: string; value: string };
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface WorkspaceEdit {
  changes?: Record<string, Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }>>;
  documentChanges?: any[];
}

/**
 * File extension to LSP language ID mapping.
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  vue: 'vue',
  svelte: 'svelte',
};

/**
 * Detect LSP language ID from file path.
 */
export function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

/**
 * Convert file path to LSP URI (file:///...).
 */
export function pathToUri(filePath: string): string {
  // Normalize path separators and ensure forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('file://')) return normalized;
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

/**
 * Convert LSP URI to file path.
 */
export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return uri.slice(7);
  }
  return uri;
}

/**
 * LSP Client — communicates with an LSP server via JSON-RPC 2.0.
 *
 * Supports:
 * - initialize/initialized handshake
 * - textDocument/didOpen, didClose, didChange
 * - textDocument/definition, references, hover, rename
 * - textDocument/publishDiagnostics notifications
 */
export class LspClient {
  readonly transport: LspTransport;
  serverCapabilities: Record<string, any> | null = null;
  initialized = false;

  private fileVersions = new Map<string, number>();
  private fileDiagnostics = new Map<string, Diagnostic[]>();
  private workspaceRoot = '';

  constructor(transport: LspTransport) {
    this.transport = transport;

    // Register handler for diagnostics notifications
    transport.registerNotificationHandler('textDocument/publishDiagnostics', (params) => {
      const uri = params.uri;
      const path = uriToPath(uri);
      this.fileDiagnostics.set(path, params.diagnostics || []);
    });
  }

  /**
   * Initialize the LSP session with the server.
   */
  async initialize(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;

    const result = await this.transport.send('initialize', {
      processId: process.pid,
      rootUri: pathToUri(workspaceRoot),
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: {
          didChangeConfiguration: { dynamicRegistration: false },
        },
      },
    });

    this.serverCapabilities = result?.capabilities ?? {};
    this.initialized = true;

    // Send initialized notification (no response expected)
    const body = this.transport.formatNotification('initialized', {});
    const message = this.transport.encodeMessage(body);
    if (this.transport.process) {
      this.transport.process.stdin!.write(message);
    }
  }

  /**
   * Open a file in the LSP server.
   */
  openFile(filePath: string, content: string): void {
    const uri = pathToUri(filePath);
    const langId = detectLanguage(filePath) || 'plaintext';
    const version = (this.fileVersions.get(filePath) ?? 0) + 1;
    this.fileVersions.set(filePath, version);

    const body = this.transport.formatNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: langId,
        version,
        text: content,
      },
    });
    const message = this.transport.encodeMessage(body);
    if (this.transport.process) {
      this.transport.process.stdin!.write(message);
    }
  }

  /**
   * Close a file in the LSP server.
   */
  closeFile(filePath: string): void {
    const uri = pathToUri(filePath);

    const body = this.transport.formatNotification('textDocument/didClose', {
      textDocument: { uri },
    });
    const message = this.transport.encodeMessage(body);
    if (this.transport.process) {
      this.transport.process.stdin!.write(message);
    }

    this.fileVersions.delete(filePath);
    this.fileDiagnostics.delete(filePath);
  }

  /**
   * Navigate to the definition of a symbol.
   */
  async gotoDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
    const result = await this.transport.send('textDocument/definition', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line: line - 1, character }, // LSP is 0-based line
    });

    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (result.uri) return [result]; // Single Location
    return [];
  }

  /**
   * Find all references to a symbol.
   */
  async findReferences(filePath: string, line: number, character: number): Promise<Location[]> {
    const result = await this.transport.send('textDocument/references', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line: line - 1, character }, // LSP is 0-based line
      context: { includeDeclaration: true },
    });

    if (!result) return [];
    return Array.isArray(result) ? result : [];
  }

  /**
   * Get hover information for a symbol.
   */
  async hover(filePath: string, line: number, character: number): Promise<Hover | null> {
    const result = await this.transport.send('textDocument/hover', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line: line - 1, character }, // LSP is 0-based line
    });

    if (!result) return null;
    // Normalize contents to string
    if (typeof result.contents === 'string') {
      return { ...result, contents: result.contents };
    }
    if (result.contents?.value) {
      return { ...result, contents: result.contents.value };
    }
    return result;
  }

  /**
   * Rename a symbol across the workspace.
   */
  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    const result = await this.transport.send('textDocument/rename', {
      textDocument: { uri: pathToUri(filePath) },
      position: { line: line - 1, character }, // LSP is 0-based line
      newName,
    });

    if (!result) return null;
    return result as WorkspaceEdit;
  }

  /**
   * Get diagnostics for a file (collected from publishDiagnostics notifications).
   */
  getDiagnostics(filePath: string): Diagnostic[] {
    return this.fileDiagnostics.get(filePath) || [];
  }

  /**
   * Clear diagnostics for a file.
   */
  clearDiagnostics(filePath: string): void {
    this.fileDiagnostics.delete(filePath);
  }

  /**
   * Shutdown the LSP session gracefully.
   */
  async close(): Promise<void> {
    try {
      if (this.initialized) {
        await this.transport.send('shutdown', null);
        const body = this.transport.formatNotification('exit', {});
        const message = this.transport.encodeMessage(body);
        if (this.transport.process) {
          this.transport.process.stdin!.write(message);
        }
      }
    } catch {
      // Server may already be dead
    } finally {
      this.transport.close();
    }
  }
}
