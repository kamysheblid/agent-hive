/**
 * Model Selector - Prioritize free models for non-essential tools
 * 
 * This utility helps select the appropriate model for different operations:
 * - Free models for simple tasks (auto-name, btca control)
 * - Premium models for complex operations (planning, code review)
 */

import { execSync } from 'child_process';

/**
 * Tools that can use free models
 */
const FREE_MODEL_TOOLS = [
  'auto_name',           // Simple text generation
  'btca_ask',            // Hardware control (doesn't need AI)
  'hive_rename',          // Simple renaming
  'lsp_status',           // Status check
  'dora_status',          // Status check
  'auto_cr_status',       // Status check
  'auto_cr_rules',        // List rules
  'code_search_index',    // Index build (no AI needed)
  'code_search_status',   // Status check (no AI needed)
];

/**
 * OpenCode free model names (when available)
 */
export const FREE_MODELS = [
  'opencode/free',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'google/gemini-flash',
] as const;

/**
 * Check if OpenCode has free model quota available
 */
export async function isFreeModelAvailable(): Promise<boolean> {
  try {
    // Try to check via OpenCode's model availability endpoint
    // This is a placeholder - actual implementation depends on OpenCode API
    const result = execSync('opencode model list 2>/dev/null || echo "unavailable"', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    
    // If we can list models, check for free ones
    return result.includes('free') || result.includes('gpt-4o-mini');
  } catch {
    // If command fails, assume free models are available as fallback
    return true;
  }
}

/**
 * Get the appropriate model for a tool
 * 
 * @param toolName - The tool name to get model for
 * @param currentModel - The current model being used
 * @returns The model to use for this tool
 */
export function getModelForTool(toolName: string, currentModel?: string): string {
  // Check if this tool can use a free model
  const canUseFreeModel = FREE_MODEL_TOOLS.some(
    pattern => toolName === pattern || toolName.includes(pattern)
  );
  
  if (canUseFreeModel) {
    // Return the first available free model
    return FREE_MODELS[0];
  }
  
  // For premium tools, use the current model
  return currentModel || 'current';
}

/**
 * Model configuration for different operation types
 */
export interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens?: number;
  description: string;
}

export const MODEL_PROFILES: Record<string, ModelConfig> = {
  // Free/cheap models for simple tasks
  'free': {
    model: FREE_MODELS[0],
    temperature: 0.3,
    maxTokens: 500,
    description: 'Fast, cheap model for simple operations',
  },
  
  // Standard models for coding
  'standard': {
    model: 'github-copilot/claude-opus-4.5',
    temperature: 0.5,
    description: 'Standard coding model',
  },
  
  // High-quality models for complex tasks
  'premium': {
    model: 'github-copilot/gpt-5.2-codex',
    temperature: 0.7,
    description: 'High-quality model for complex reasoning',
  },
  
  // Reasoning models
  'reasoning': {
    model: 'anthropic/claude-sonnet-4-20250514',
    temperature: 0.3,
    description: 'Model optimized for reasoning and analysis',
  },
};

/**
 * Get model profile for an operation type
 */
export function getModelProfile(operationType: 'free' | 'standard' | 'premium' | 'reasoning'): ModelConfig {
  return MODEL_PROFILES[operationType];
}

/**
 * Tool categorization by operation complexity
 */
export const TOOL_CATEGORIES: Record<string, 'free' | 'standard' | 'premium'> = {
  // Free - Simple operations that don't need complex reasoning
  'auto_name': 'free',
  'btca_ask': 'free',
  'hive_rename': 'free',
  'lsp_status': 'free',
  'lsp_install': 'free',
  'dora_status': 'free',
  'dora_cycles': 'free',
  'dora_unused': 'free',
  'auto_cr_status': 'free',
  'auto_cr_rules': 'free',
  'hive_memory_list': 'free',
  'hive_memory_forget': 'free',
  'hive_vector_status': 'free',
  'pty_list': 'free',
  'pty_kill': 'free',
  
  // Standard - Normal coding operations
  'lsp_rename': 'standard',
  'lsp_goto_definition': 'standard',
  'lsp_find_references': 'standard',
  'lsp_diagnostics': 'standard',
  'lsp_hover': 'standard',
  'lsp_code_actions': 'standard',
  'dora_symbol': 'standard',
  'dora_file': 'standard',
  'dora_references': 'standard',
  'auto_cr_scan': 'standard',
  'auto_cr_diff': 'standard',
  'ast_grep_find_code': 'standard',
  'ast_grep_scan_code': 'standard',
  'ast_grep_analyze_imports': 'standard',
  'code_search': 'standard',
  'call_graph_callees': 'standard',
  'call_graph_callers': 'standard',
  'call_graph_extract': 'standard',
  'hive_memory_set': 'standard',
  'hive_memory_recall': 'standard',
  'hive_vector_search': 'standard',
  
  // Premium - Complex operations that benefit from better models
  'hive_code_edit': 'premium',
  'hive_lazy_edit': 'premium',
  'ast_grep_rewrite_code': 'premium',
  'ast_grep_dump_syntax_tree': 'premium',
  'ast_grep_test_match_code_rule': 'premium',
  'call_graph_path': 'premium',
  'artifact_search': 'premium',
  'skill_mcp': 'premium',
};

/**
 * Get the appropriate model profile for a tool
 */
export function getModelForToolCategory(toolName: string): ModelConfig {
  const category = TOOL_CATEGORIES[toolName] || 'standard';
  return MODEL_PROFILES[category];
}

/**
 * Check if a tool should use a free model
 */
export function shouldUseFreeModel(toolName: string): boolean {
  return TOOL_CATEGORIES[toolName] === 'free';
}

/**
 * Model Selector class for managing model selection
 */
export class ModelSelector {
  private freeModelCache: boolean | null = null;
  
  /**
   * Check if free model is available
   */
  async isFreeModelAvailable(): Promise<boolean> {
    if (this.freeModelCache !== null) {
      return this.freeModelCache;
    }
    
    this.freeModelCache = await isFreeModelAvailable();
    return this.freeModelCache;
  }
  
  /**
   * Get model for a specific tool
   */
  async getModelForTool(toolName: string, currentModel?: string): Promise<string> {
    const canUseFree = await this.isFreeModelAvailable();
    
    if (canUseFree && shouldUseFreeModel(toolName)) {
      return FREE_MODELS[0];
    }
    
    return currentModel || MODEL_PROFILES.standard.model;
  }
  
  /**
   * Clear the free model cache
   */
  clearCache(): void {
    this.freeModelCache = null;
  }
}

// Export singleton
export const modelSelector = new ModelSelector();
