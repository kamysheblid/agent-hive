/**
 * LSP module — real LSP client using JSON-RPC 2.0 over stdio.
 *
 * Exports:
 * - LspTransport: JSON-RPC transport layer
 * - LspClient: LSP protocol client
 * - LspManager: Client lifecycle management
 */
export { LspTransport, createLspTransport } from './transport.js';
export { LspClient, detectLanguage, pathToUri, uriToPath } from './client.js';
export type { Location, Diagnostic, Hover, WorkspaceEdit } from './client.js';
export { LspManager, lspClientManager, getLspClientForFile } from './manager.js';
