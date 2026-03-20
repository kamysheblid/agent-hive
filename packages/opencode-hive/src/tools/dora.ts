import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { execSync } from 'child_process';

/**
 * Dora CLI Tool - SCIP-based code navigation
 * 
 * @butttons/dora provides fast, structured code intelligence.
 * Requires: dora binary + scip-typescript indexer
 * 
 * Features:
 * - Symbol search
 * - Dependency tracking
 * - Reference finding
 * - Cycle detection
 */

/**
 * Check if dora is installed and working
 */
function checkDoraStatus(): { installed: boolean; version?: string; indexed: boolean } {
  try {
    const output = execSync('dora --version', { encoding: 'utf-8' });
    const version = output.trim();
    
    // Check if index exists
    const indexExists = require('fs').existsSync('.dora/dora.db');
    
    return { installed: true, version, indexed: indexExists };
  } catch {
    return { installed: false, indexed: false };
  }
}

/**
 * Execute dora command with error handling
 */
function runDoraCommand(args: string[]): { success: boolean; output?: string; error?: string } {
  try {
    const output = execSync(`dora ${args.join(' ')}`, { 
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    return { success: true, output };
  } catch (error: any) {
    return { success: false, error: error.message || 'Command failed' };
  }
}

// ============================================================================
// Tool: dora_status
// ============================================================================

export const doraStatusTool: ToolDefinition = tool({
  description: `Check dora installation status and index state.

**Returns:**
- installed: Whether dora CLI is available
- version: Dora version
- indexed: Whether codebase has been indexed

**Requirements:**
- Install dora: \`bun install -g @butttons/dora\`
- Install SCIP indexer: \`npm install -g @sourcegraph/scip-typescript\`
- Initialize: \`dora init && dora index\`

**Note:** Indexing is required once per codebase. After that, dora works instantly.`,

  args: {},

  async execute() {
    const status = checkDoraStatus();

    if (!status.installed) {
      return JSON.stringify({
        status: 'not_installed',
        message: 'Dora CLI not found',
        installation: {
          step1: 'bun install -g @butttons/dora',
          step2: 'npm install -g @sourcegraph/scip-typescript',
          step3: 'dora init && dora index',
        },
      }, null, 2);
    }

    if (!status.indexed) {
      return JSON.stringify({
        status: 'not_indexed',
        version: status.version,
        message: 'Codebase not indexed',
        nextStep: 'Run: dora init && dora index',
      }, null, 2);
    }

    return JSON.stringify({
      status: 'ready',
      version: status.version,
      indexed: true,
      message: 'Dora is ready',
    }, null, 2);
  },
});

// ============================================================================
// Tool: dora_symbol
// ============================================================================

export const doraSymbolTool: ToolDefinition = tool({
  description: `Find symbol definitions using dora (SCIP-based).

**Parameters:**
- name: Symbol name to search for
- kind: Filter by symbol kind (function, class, method, etc.)

**Example:**
\`\`\`
dora_symbol({ name: "getUserById" })
\`\`\`

**Note:** Requires dora to be installed and indexed.`,

  args: {
    name: tool.schema.string().describe('Symbol name to search for'),
    kind: tool.schema.string().optional().describe('Filter by symbol kind (function, class, method, etc.)'),
  },

  async execute({ name, kind }) {
    const status = checkDoraStatus();
    
    if (!status.installed || !status.indexed) {
      return JSON.stringify({
        success: false,
        error: 'Dora not ready. Run dora_status first.',
        hint: 'Install and index: dora init && dora index',
      }, null, 2);
    }

    const args = ['symbol', name];
    if (kind) {
      args.push('--kind', kind);
    }

    const result = runDoraCommand(args);
    
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error,
        hint: 'Symbol may not exist or not indexed',
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      symbol: name,
      output: result.output,
    }, null, 2);
  },
});

// ============================================================================
// Tool: dora_file
// ============================================================================

export const doraFileTool: ToolDefinition = tool({
  description: `Get file dependencies and information using dora.

**Parameters:**
- path: File path to analyze

**Example:**
\`\`\`
dora_file({ path: "src/index.ts" })
\`\`\`

**Returns:** File metadata, exports, and dependencies.`,

  args: {
    path: tool.schema.string().describe('File path to analyze'),
  },

  async execute({ path }) {
    const status = checkDoraStatus();
    
    if (!status.installed || !status.indexed) {
      return JSON.stringify({
        success: false,
        error: 'Dora not ready. Run dora_status first.',
      }, null, 2);
    }

    const result = runDoraCommand(['file', path]);
    
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error,
        hint: 'File may not exist or not indexed',
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      path,
      output: result.output,
    }, null, 2);
  },
});

// ============================================================================
// Tool: dora_references
// ============================================================================

export const doraReferencesTool: ToolDefinition = tool({
  description: `Find all references to a symbol using dora.

**Parameters:**
- name: Symbol name to find references for

**Example:**
\`\`\`
dora_references({ name: "UserService" })
\`\`\`

**Note:** Returns all usages across the codebase.`,

  args: {
    name: tool.schema.string().describe('Symbol name to find references for'),
  },

  async execute({ name }) {
    const status = checkDoraStatus();
    
    if (!status.installed || !status.indexed) {
      return JSON.stringify({
        success: false,
        error: 'Dora not ready. Run dora_status first.',
      }, null, 2);
    }

    const result = runDoraCommand(['references', name]);
    
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error,
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      symbol: name,
      output: result.output,
    }, null, 2);
  },
});

// ============================================================================
// Tool: dora_cycles
// ============================================================================

export const doraCyclesTool: ToolDefinition = tool({
  description: `Detect circular dependencies in the codebase using dora.

**Example:**
\`\`\`
dora_cycles()
\`\`\`

**Returns:** List of circular dependency paths if found.`,

  args: {},

  async execute() {
    const status = checkDoraStatus();
    
    if (!status.installed || !status.indexed) {
      return JSON.stringify({
        success: false,
        error: 'Dora not ready. Run dora_status first.',
      }, null, 2);
    }

    const result = runDoraCommand(['cycles']);
    
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error,
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      cycles: result.output,
    }, null, 2);
  },
});

// ============================================================================
// Tool: dora_unused
// ============================================================================

export const doraUnusedTool: ToolDefinition = tool({
  description: `Find unused/dead code in the codebase using dora.

**Example:**
\`\`\`
dora_unused()
\`\`\`

**Returns:** List of symbols with zero references.`,

  args: {},

  async execute() {
    const status = checkDoraStatus();
    
    if (!status.installed || !status.indexed) {
      return JSON.stringify({
        success: false,
        error: 'Dora not ready. Run dora_status first.',
      }, null, 2);
    }

    const result = runDoraCommand(['unused']);
    
    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error,
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      unused: result.output,
    }, null, 2);
  },
});
