import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Agent Booster Tool
 * 
 * Ultra-fast code editing engine using @sparkleideas/agent-booster.
 * - 52x faster than Morph LLM
 * - FREE (no API key required)
 * - Rust+WASM powered
 * 
 * Uses lazy loading - only initializes when first called.
 */

export interface AgentBoosterEdit {
  path: string;
  oldContent: string;
  newContent: string;
}

export interface AgentBoosterResult {
  success: boolean;
  path: string;
  applied?: string;
  error?: string;
  fallback?: boolean;
}

// Lazy-loaded booster instance
let boosterInstance: any = null;
let boosterInitPromise: Promise<void> | null = null;

/**
 * Initialize agent-booster with lazy loading
 */
async function initBooster(): Promise<void> {
  if (boosterInstance !== null) {
    return;
  }
  
  if (boosterInitPromise !== null) {
    await boosterInitPromise;
    return;
  }
  
  boosterInitPromise = (async () => {
    try {
      // Dynamic require - only loads when needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const booster = require('@sparkleideas/agent-booster');
      
      // Initialize the booster
      if (booster && typeof booster.init === 'function') {
        await booster.init();
        boosterInstance = booster;
      } else if (booster && typeof booster.default === 'function') {
        boosterInstance = booster.default;
      } else {
        boosterInstance = booster || {};
      }
      
      console.log('[agent-booster] Initialized successfully');
    } catch (error) {
      console.warn('[agent-booster] Failed to initialize:', error instanceof Error ? error.message : error);
      boosterInstance = null;
    }
  })();
  
  await boosterInitPromise;
}

/**
 * Apply edit using agent-booster
 */
async function applyWithBooster(edit: AgentBoosterEdit): Promise<AgentBoosterResult> {
  await initBooster();
  
  if (!boosterInstance) {
    return {
      success: false,
      path: edit.path,
      error: 'Agent booster not available',
      fallback: true,
    };
  }
  
  try {
    // Check if file exists
    if (!fs.existsSync(edit.path)) {
      return {
        success: false,
        path: edit.path,
        error: `File not found: ${edit.path}`,
      };
    }
    
    // Read current content
    const currentContent = fs.readFileSync(edit.path, 'utf-8');
    
    // Use agent-booster's fast apply if available
    if (typeof boosterInstance.fastApply === 'function') {
      const result = await boosterInstance.fastApply({
        path: edit.path,
        old: edit.oldContent,
        new: edit.newContent,
      });
      
      return {
        success: result.success ?? true,
        path: edit.path,
        applied: result.applied ?? 'Applied via agent-booster',
      };
    }
    
    // Fallback: simple string replacement
    if (currentContent.includes(edit.oldContent)) {
      const newContent = currentContent.replace(edit.oldContent, edit.newContent);
      fs.writeFileSync(edit.path, newContent, 'utf-8');
      
      return {
        success: true,
        path: edit.path,
        applied: 'Applied via fallback (string replace)',
      };
    }
    
    return {
      success: false,
      path: edit.path,
      error: 'oldContent not found in file',
    };
  } catch (error) {
    return {
      success: false,
      path: edit.path,
      error: error instanceof Error ? error.message : String(error),
      fallback: true,
    };
  }
}

/**
 * Apply edit with fallback to native implementation
 */
export async function applyCodeEdit(edit: AgentBoosterEdit): Promise<AgentBoosterResult> {
  // Try agent-booster first
  const boosterResult = await applyWithBooster(edit);
  
  if (boosterResult.success) {
    return boosterResult;
  }
  
  // Fallback: native string replace
  try {
    if (!fs.existsSync(edit.path)) {
      return {
        success: false,
        path: edit.path,
        error: `File not found: ${edit.path}`,
      };
    }
    
    const currentContent = fs.readFileSync(edit.path, 'utf-8');
    
    if (!currentContent.includes(edit.oldContent)) {
      return {
        success: false,
        path: edit.path,
        error: 'oldContent not found in file',
      };
    }
    
    const newContent = currentContent.replace(edit.oldContent, edit.newContent);
    fs.writeFileSync(edit.path, newContent, 'utf-8');
    
    return {
      success: true,
      path: edit.path,
      applied: 'Applied via native fallback',
    };
  } catch (error) {
    return {
      success: false,
      path: edit.path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if agent-booster is available
 */
export async function isBoosterAvailable(): Promise<boolean> {
  await initBooster();
  return boosterInstance !== null;
}

/**
 * Get booster status
 */
export async function getBoosterStatus(): Promise<{
  available: boolean;
  version?: string;
}> {
  const available = await isBoosterAvailable();
  
  if (!available) {
    return { available: false };
  }
  
  try {
    const booster = await import('@sparkleideas/agent-booster');
    return {
      available: true,
      version: (booster as any).version || 'unknown',
    };
  } catch {
    return { available: true };
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

export const hiveCodeEditTool: ToolDefinition = tool({
  description: `Ultra-fast code editing using agent-booster (52x faster than Morph, FREE).

**Features:**
- 52x faster than Morph LLM
- No API key required
- Rust+WASM powered
- Graceful fallback to native edit

**Usage:**
- oldContent: Exact text to replace (must match file content)
- newContent: Replacement text
- Automatically falls back to native edit if agent-booster unavailable`,

  args: {
    path: tool.schema.string().describe('Absolute or relative path to the file to edit'),
    oldContent: tool.schema.string().describe('Exact text to find and replace'),
    newContent: tool.schema.string().describe('Replacement text'),
  },

  async execute({ path: filePath, oldContent, newContent }) {
    // Resolve relative paths
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    const result = await applyCodeEdit({
      path: resolvedPath,
      oldContent,
      newContent,
    });

    if (!result.success) {
      return JSON.stringify({
        success: false,
        error: result.error,
        hint: 'Ensure oldContent matches exactly. Check for whitespace differences.',
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      path: result.path,
      applied: result.applied,
      message: `Edit applied successfully`,
    }, null, 2);
  },
});

/**
 * Lazy edit marker tool - uses agent-booster's special marker syntax
 * Allows partial code snippets with // ... existing code ... placeholders
 */
export const hiveLazyEditTool: ToolDefinition = tool({
  description: `Fast code editing with lazy markers using agent-booster.

**Lazy Markers:**
Use \`// ... existing code ...\` to indicate unchanged sections.
Agent-booster intelligently merges your partial code into the full file.

**Example:**
\`\`\`
// ... existing code ...
const newFunction = () => { ... };
// ... existing code ...
\`\`\`

**Note:** Requires @sparkleideas/agent-booster to be installed and enabled.`,

  args: {
    path: tool.schema.string().describe('File path'),
    snippet: tool.schema.string().describe('Code snippet with // ... existing code ... markers'),
  },

  async execute({ path: filePath, snippet }) {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    // Check if agent-booster is available
    const available = await isBoosterAvailable();
    
    if (!available) {
      return JSON.stringify({
        success: false,
        error: 'agent-booster not available',
        hint: 'Install @sparkleideas/agent-booster or use hive_code_edit for native editing',
      }, null, 2);
    }

    try {
      // Use agent-booster's lazy apply
      if (typeof boosterInstance.lazyApply === 'function') {
        const result = await boosterInstance.lazyApply({
          path: resolvedPath,
          snippet,
        });

        return JSON.stringify({
          success: result.success ?? true,
          path: resolvedPath,
          message: result.message || 'Lazy edit applied',
        }, null, 2);
      }

      return JSON.stringify({
        success: false,
        error: 'Lazy apply not supported',
        hint: 'Update @sparkleideas/agent-booster for lazy edit support',
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2);
    }
  },
});

/**
 * Tool to check agent-booster status
 */
export const hiveBoosterStatusTool: ToolDefinition = tool({
  description: `Check agent-booster availability and status.

**Returns:**
- available: Whether agent-booster is installed and working
- version: Agent-booster version (if available)
- speed: Performance comparison vs native editing`,

  args: {},

  async execute() {
    const status = await getBoosterStatus();

    return JSON.stringify({
      ...status,
      performance: {
        agentBooster: '52x faster than Morph',
        native: 'baseline',
        savings: '60-90% tokens on large files',
      },
      installation: status.available
        ? 'Ready'
        : 'Run: npm install @sparkleideas/agent-booster',
    }, null, 2);
  },
});
