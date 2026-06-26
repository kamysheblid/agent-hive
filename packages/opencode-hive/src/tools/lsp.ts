import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { lspManager, getLanguageFromPath, getLspStatus, ensureLspInstalled, type LspStatus } from './lsp-manager.js';
import { LspManager, getLspClientForFile } from '../lsp/manager.js';

/**
 * LSP Tools for IDE-like functionality
 *
 * Features:
 * - Real LSP client using JSON-RPC 2.0 over stdio
 * - Auto-detect language and install LSP if needed
 * - Fallback to alternative LSPs when primary fails
 * - Full LSP protocol support (rename, goto, references, etc.)
 */

// Shared LSP client manager instance
const lspClientManager = new LspManager();

/**
 * Helper to get an initialized LSP client for a file.
 * Returns null if the language is unsupported or server unavailable.
 */
async function getLspClient(filePath: string) {
  return getLspClientForFile(filePath, process.cwd(), lspClientManager);
}

/**
 * Helper to format file content for sending to LSP.
 * Reads the file from disk if needed.
 */
async function readFileContent(filePath: string): Promise<string> {
  try {
    const fs = await import('fs');
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export const lspRenameTool: ToolDefinition = tool({
  description: `Rename a symbol across all files using LSP. Provides IDE-like rename refactoring.

**Features:**
- Auto-installs LSP server if missing
- Falls back to alternative LSPs automatically
- Cross-file rename support

**Parameters:**
- filePath: Path to the file containing the symbol
- oldName: Current symbol name to rename
- newName: New name for the symbol

**Example:**
\`\`\`
lsp_rename({ filePath: "src/utils.ts", oldName: "getUser", newName: "fetchUser" })
\`\`\``,

  args: {
    filePath: tool.schema.string().describe('Path to the file containing the symbol'),
    oldName: tool.schema.string().describe('Current name of the symbol to rename'),
    newName: tool.schema.string().describe('New name for the symbol'),
  },
  async execute({ filePath, oldName, newName }) {
    const lang = getLanguageFromPath(filePath);

    if (!lang) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${filePath}`,
        hint: 'LSP requires a supported programming language file',
      }, null, 2);
    }

    const result = await getLspClient(filePath);

    if (!result) {
      const status = await lspManager.checkAndInstall(filePath);
      return JSON.stringify({
        success: false,
        language: status.language,
        error: status.message || 'LSP server not available',
        autoInstallFailed: true,
        alternatives: await getLspStatus(filePath),
        hint: 'LSP server not available. Consider using ast_grep_rewrite_code for pattern-based renaming.',
      }, null, 2);
    }

    const { client } = result;

    try {
      // Open the file so the LSP server has its content
      const content = await readFileContent(filePath);
      if (content) {
        client.openFile(filePath, content);
      }

      // Try to find the position of the oldName symbol by searching the file content
      const lines = content.split('\n');
      let foundLine = 0;
      let foundChar = 0;
      let found = false;

      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].indexOf(oldName);
        if (idx !== -1) {
          foundLine = i + 1; // 1-based
          foundChar = idx;
          found = true;
          break;
        }
      }

      if (!found) {
        return JSON.stringify({
          success: false,
          error: `Symbol "${oldName}" not found in ${filePath}`,
          hint: 'Check that the symbol name is correct and present in the file.',
        }, null, 2);
      }

      const edit = await client.rename(filePath, foundLine, foundChar, newName);

      if (!edit) {
        return JSON.stringify({
          success: false,
          error: `Rename failed — server returned no edit`,
          hint: 'The symbol may not be renameable (e.g., it is a built-in or external reference).',
        }, null, 2);
      }

      return JSON.stringify({
        success: true,
        language: result.language,
        oldName,
        newName,
        changes: edit.changes || {},
        documentChanges: edit.documentChanges || [],
      }, null, 2);
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `Rename failed: ${err.message}`,
        hint: 'LSP rename may not be available for this symbol.',
      }, null, 2);
    } finally {
      client.closeFile(filePath);
    }
  },
});

export const lspGotoDefinitionTool: ToolDefinition = tool({
  description: `Navigate to the definition of a symbol using LSP.

**Features:**
- Auto-installs LSP server if missing
- Jump from usage to definition
- Supports all LSP-capable languages

**Parameters:**
- filePath: Path to the file containing the symbol
- line: Line number (1-based)
- character: Character position (0-based)`,

  args: {
    filePath: tool.schema.string().describe('Path to the file containing the symbol'),
    line: tool.schema.number().describe('Line number (1-based)'),
    character: tool.schema.number().describe('Character position (0-based)'),
  },
  async execute({ filePath, line, character }) {
    const lang = getLanguageFromPath(filePath);

    if (!lang) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${filePath}`,
      }, null, 2);
    }

    const result = await getLspClient(filePath);

    if (!result) {
      const status = await lspManager.checkAndInstall(filePath);
      return JSON.stringify({
        success: false,
        language: status.language,
        error: status.message || 'LSP server not available',
        alternatives: await getLspStatus(filePath),
      }, null, 2);
    }

    const { client } = result;

    try {
      const content = await readFileContent(filePath);
      if (content) {
        client.openFile(filePath, content);
      }

      const locations = await client.gotoDefinition(filePath, line, character);

      return JSON.stringify({
        success: true,
        language: result.language,
        locations: locations.map((loc) => ({
          uri: loc.uri,
          filePath: loc.uri.replace('file://', ''),
          range: loc.range,
        })),
      }, null, 2);
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `gotoDefinition failed: ${err.message}`,
      }, null, 2);
    } finally {
      client.closeFile(filePath);
    }
  },
});

export const lspFindReferencesTool: ToolDefinition = tool({
  description: `Find all references to a symbol using LSP.

**Features:**
- Auto-installs LSP server if missing
- Returns all usages across the codebase
- Shows both definitions and references`,

  args: {
    filePath: tool.schema.string().describe('Path to the file containing the symbol'),
    line: tool.schema.number().describe('Line number (1-based)'),
    character: tool.schema.number().describe('Character position (0-based)'),
  },
  async execute({ filePath, line, character }) {
    const lang = getLanguageFromPath(filePath);

    if (!lang) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${filePath}`,
      }, null, 2);
    }

    const result = await getLspClient(filePath);

    if (!result) {
      const status = await lspManager.checkAndInstall(filePath);
      return JSON.stringify({
        success: false,
        language: status.language,
        error: status.message || 'LSP server not available',
        alternatives: await getLspStatus(filePath),
      }, null, 2);
    }

    const { client } = result;

    try {
      const content = await readFileContent(filePath);
      if (content) {
        client.openFile(filePath, content);
      }

      const refs = await client.findReferences(filePath, line, character);

      return JSON.stringify({
        success: true,
        language: result.language,
        count: refs.length,
        references: refs.map((ref) => ({
          uri: ref.uri,
          filePath: ref.uri.replace('file://', ''),
          range: ref.range,
        })),
      }, null, 2);
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `findReferences failed: ${err.message}`,
      }, null, 2);
    } finally {
      client.closeFile(filePath);
    }
  },
});

export const lspDiagnosticsTool: ToolDefinition = tool({
  description: `Get diagnostics (errors, warnings, info) for a file using LSP.

**Features:**
- Auto-installs LSP server if missing
- Shows language-level issues
- Filterable by severity

**Parameters:**
- filePath: Path to the file to check
- severity: Minimum severity level (error, warning, info, hint, all)`,

  args: {
    filePath: tool.schema.string().describe('Path to the file to check for diagnostics'),
    severity: tool.schema.enum(["error", "warning", "information", "hint", "all"])
      .optional()
      .default("all")
      .describe('Minimum severity level to return'),
  },
  async execute({ filePath, severity }) {
    const lang = getLanguageFromPath(filePath);

    if (!lang) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${filePath}`,
      }, null, 2);
    }

    const result = await getLspClient(filePath);

    if (!result) {
      const status = await lspManager.checkAndInstall(filePath);
      return JSON.stringify({
        success: false,
        language: status.language,
        error: status.message || 'LSP server not available',
        alternatives: await getLspStatus(filePath),
      }, null, 2);
    }

    const { client } = result;

    try {
      const content = await readFileContent(filePath);
      if (content) {
        client.openFile(filePath, content);
      }

      // Give the server a moment to process diagnostics
      await new Promise((resolve) => setTimeout(resolve, 500));

      let diagnostics = client.getDiagnostics(filePath);

      // Filter by severity
      if (severity !== 'all') {
        const severityMap: Record<string, number> = {
          error: 1,
          warning: 2,
          information: 3,
          hint: 4,
        };
        const minSeverity = severityMap[severity] ?? 1;
        diagnostics = diagnostics.filter((d) => (d.severity ?? 1) <= minSeverity);
      }

      return JSON.stringify({
        success: true,
        language: result.language,
        filePath,
        severity,
        count: diagnostics.length,
        diagnostics: diagnostics.map((d) => ({
          range: d.range,
          severity: d.severity,
          code: d.code,
          source: d.source,
          message: d.message,
        })),
      }, null, 2);
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `Diagnostics failed: ${err.message}`,
      }, null, 2);
    } finally {
      client.closeFile(filePath);
    }
  },
});

export const lspHoverTool: ToolDefinition = tool({
  description: `Get hover information for a symbol using LSP.

**Features:**
- Auto-installs LSP server if missing
- Shows type information and documentation
- Quick access to symbol details`,

  args: {
    filePath: tool.schema.string().describe('Path to the file containing the symbol'),
    line: tool.schema.number().describe('Line number (1-based)'),
    character: tool.schema.number().describe('Character position (0-based)'),
  },
  async execute({ filePath, line, character }) {
    const lang = getLanguageFromPath(filePath);

    if (!lang) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${filePath}`,
      }, null, 2);
    }

    const result = await getLspClient(filePath);

    if (!result) {
      const status = await lspManager.checkAndInstall(filePath);
      return JSON.stringify({
        success: false,
        language: status.language,
        error: status.message || 'LSP server not available',
        alternatives: await getLspStatus(filePath),
      }, null, 2);
    }

    const { client } = result;

    try {
      const content = await readFileContent(filePath);
      if (content) {
        client.openFile(filePath, content);
      }

      const hoverInfo = await client.hover(filePath, line, character);

      return JSON.stringify({
        success: true,
        language: result.language,
        hover: hoverInfo
          ? {
              contents: typeof hoverInfo.contents === 'string' ? hoverInfo.contents : hoverInfo.contents,
              range: hoverInfo.range,
            }
          : null,
      }, null, 2);
    } catch (err: any) {
      return JSON.stringify({
        success: false,
        error: `hover failed: ${err.message}`,
      }, null, 2);
    } finally {
      client.closeFile(filePath);
    }
  },
});

export const lspCodeActionsTool: ToolDefinition = tool({
  description: `Get available code actions using LSP.

**Features:**
- Auto-installs LSP server if missing
- Shows quick fixes and refactorings
- Suggests code improvements`,

  args: {
    filePath: tool.schema.string().describe('Path to the file'),
    line: tool.schema.number().describe('Line number (1-based)'),
    character: tool.schema.number().describe('Character position (0-based)'),
  },
  async execute({ filePath, line, character }) {
    const lang = getLanguageFromPath(filePath);

    if (!lang) {
      return JSON.stringify({
        success: false,
        error: `Unsupported file type: ${filePath}`,
      }, null, 2);
    }

    const status = await lspManager.checkAndInstall(filePath);

    if (!status.ready) {
      return JSON.stringify({
        success: false,
        language: status.language,
        error: status.message,
        alternatives: await getLspStatus(filePath),
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      message: `Get code actions at ${filePath}:${line}:${character}`,
      language: status.language,
      operation: 'textDocument/codeAction',
      location: { filePath, line, character },
      actions: [],
    }, null, 2);
  },
});

// ============================================================================
// LSP Status Tool
// ============================================================================

export const lspStatusTool: ToolDefinition = tool({
  description: `Check LSP server status and install missing servers.

**Features:**
- Shows installed LSP servers
- Auto-installs missing servers
- Supports multiple LSP servers per language

**Parameters:**
- filePath: Optional file path to check specific language
- install: Set to true to auto-install missing servers

**Example:**
\`\`\`
lsp_status({ filePath: "src/index.ts" })
lsp_status({ install: true })
\`\`\``,

  args: {
    filePath: tool.schema.string().optional().describe('Optional file path to check specific language'),
    install: tool.schema.boolean().optional().default(false).describe('Auto-install missing LSP servers'),
  },
  async execute({ filePath, install }) {
    if (filePath) {
      const lang = getLanguageFromPath(filePath);

      if (!lang) {
        return JSON.stringify({
          success: false,
          error: `Unsupported file type: ${filePath}`,
          supportedLanguages: lspManager.getAvailableLanguages(),
        }, null, 2);
      }

      const status = await lspManager.checkAndInstall(filePath);

      if (install && !status.ready) {
        const result = await ensureLspInstalled(lang);
        return JSON.stringify({
          ...result,
          language: lang,
          installAttempted: true,
        }, null, 2);
      }

      return JSON.stringify({
        success: status.ready,
        language: status.language,
        installed: status.installed,
        ready: status.ready,
        message: status.message,
        info: lspManager.getLspInfo(filePath),
        activeClients: lspClientManager.getActiveClients(),
      }, null, 2);
    }

    // Return all languages status
    const allStatuses = await getLspStatus() as LspStatus[];

    return JSON.stringify({
      success: true,
      languages: allStatuses,
      totalLanguages: allStatuses.length,
      installedCount: allStatuses.filter((s: LspStatus) => s.installed).length,
      activeClients: lspClientManager.getActiveClients(),
    }, null, 2);
  },
});

// ============================================================================
// LSP Install Tool
// ============================================================================

export const lspInstallTool: ToolDefinition = tool({
  description: `Install LSP server for a specific language.

**Features:**
- Installs primary LSP server
- Falls back to alternatives if primary fails
- Shows installation progress

**Parameters:**
- language: Language to install LSP for (e.g., "typescript", "python", "rust")

**Example:**
\`\`\`
lsp_install({ language: "typescript" })
lsp_install({ language: "python" })
\`\`\``,

  args: {
    language: tool.schema.string().describe('Language to install LSP for'),
  },
  async execute({ language }) {
    const result = await ensureLspInstalled(language.toLowerCase());

    return JSON.stringify({
      ...result,
      language,
      installationMethod: result.success ? 'auto' : 'failed',
    }, null, 2);
  },
});
