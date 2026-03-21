import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Hive Doctor - System health check and optimization advisor
 * 
 * Checks:
 * 1. Dependencies - optional packages installed?
 * 2. CLI Tools - dora, auto-cr, ast-grep, etc. available?
 * 3. Native Binaries - @ast-grep/napi tree-sitter binaries?
 * 4. Config - features and settings properly configured?
 */

interface DependencyCheck {
  name: string;
  package: string;
  installed: boolean;
  version?: string;
  optional: boolean;
}

interface CliToolCheck {
  name: string;
  command: string;
  installed: boolean;
  version?: string;
  description: string;
}

interface NativeBinaryCheck {
  name: string;
  path: string;
  installed: boolean;
  reason?: string;
}

interface ConfigCheck {
  name: string;
  enabled: boolean;
  value?: any;
  recommendation: string;
}

interface DoctorResult {
  status: 'healthy' | 'warning' | 'action-required';
  summary: {
    dependencies: string;
    cliTools: string;
    nativeBinaries: string;
    config: string;
  };
  details: {
    dependencies: {
      total: number;
      installed: number;
      missing: DependencyCheck[];
    };
    cliTools: {
      total: number;
      available: number;
      missing: CliToolCheck[];
    };
    nativeBinaries: {
      status: 'native' | 'cli-mode' | 'unavailable';
      reason?: string;
      astGrep?: {
        available: boolean;
        version?: string;
      };
    };
    config: ConfigCheck[];
  };
  actionItems: {
    priority: 'high' | 'medium' | 'low';
    action: string;
    command?: string;
    reason: string;
  }[];
  quickInstall: {
    deps: string[];
    cliTools: string[];
  };
}

/**
 * Check if a package is installed
 */
async function checkPackage(packageName: string): Promise<DependencyCheck> {
  const result: DependencyCheck = {
    name: packageName,
    package: packageName,
    installed: false,
    optional: true,
  };
  
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [process.cwd(), path.join(process.cwd(), 'node_modules')],
    });
    
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      result.installed = true;
      result.version = pkg.version;
    }
  } catch {}
  
  return result;
}

/**
 * Check if CLI tool is available
 */
function checkCliTool(name: string, command: string, description: string): CliToolCheck {
  const result: CliToolCheck = {
    name,
    command,
    installed: false,
    description,
  };
  
  // Try direct command
  try {
    execSync(command.split(' ')[0], { stdio: 'pipe', timeout: 3000 });
    result.installed = true;
    result.version = 'installed';
  } catch {
    // Try npx with short timeout
    try {
      execSync(`npx -y ${command.split(' ')[0]} --version`, { stdio: 'pipe', timeout: 5000 });
      result.installed = true;
      result.version = 'via npx';
    } catch {}
  }
  
  return result;
}

/**
 * Check native @ast-grep/napi binaries
 */
function checkAstGrepNative(): { available: boolean; version?: string; reason?: string } {
  const result: { available: boolean; version?: string; reason?: string } = { 
    available: false, 
    reason: '' 
  };
  
  try {
    // Check if @ast-grep/napi package exists
    const napiPath = require.resolve('@ast-grep/napi');
    const napiDir = path.dirname(napiPath);
    
    // Check for native binaries in common locations
    const binaryPaths = [
      path.join(napiDir, 'index.node'),
      path.join(napiDir, 'build', 'Release', 'ast_grep.node'),
      path.join(napiDir, 'dist', 'index.node'),
    ];
    
    const binaryExists = binaryPaths.some(p => fs.existsSync(p));
    
    if (binaryExists) {
      result.available = true;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(napiDir, 'package.json'), 'utf-8'));
        result.version = pkg.version;
      } catch {}
    } else {
      result.reason = 'Native binaries not compiled (tree-sitter failed to build)';
    }
  } catch (error) {
    result.reason = '@ast-grep/napi not installed';
  }
  
  return result;
}

/**
 * Check config file
 */
function checkConfig(): ConfigCheck[] {
  const checks: ConfigCheck[] = [];
  
  const configPaths = [
    path.join(process.env.HOME || '', '.config/opencode/agent_hive.json'),
    path.join(process.env.HOME || '', '.config/opencode/agent_hive.jsonc'),
  ];
  
  let config: any = null;
  
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(content.replace(/\\/g, ''));
        break;
      } catch {}
    }
  }
  
  // Check snip
  const snipEnabled = config?.snip?.enabled === true;
  checks.push({
    name: 'snip',
    enabled: snipEnabled,
    value: config?.snip,
    recommendation: snipEnabled 
      ? 'snip enabled for 60-90% token reduction'
      : 'Enable snip: Add { "snip": { "enabled": true } } to config',
  });
  
  // Check vector memory
  const vectorEnabled = config?.vectorMemory?.enabled === true;
  checks.push({
    name: 'vectorMemory',
    enabled: vectorEnabled,
    value: config?.vectorMemory,
    recommendation: vectorEnabled
      ? 'Vector memory enabled for semantic search'
      : 'Enable vector memory: Add { "vectorMemory": { "enabled": true } } to config',
  });
  
  // Check agent booster
  const boosterEnabled = config?.agentBooster?.enabled !== false;
  checks.push({
    name: 'agentBooster',
    enabled: boosterEnabled,
    value: config?.agentBooster,
    recommendation: boosterEnabled
      ? 'Agent booster enabled for 52x faster editing'
      : 'Agent booster disabled: Set { "agentBooster": { "enabled": true } } to enable',
  });
  
  // Check sandbox
  const sandboxMode = config?.sandbox?.mode || 'none';
  const sandboxEnabled = sandboxMode !== 'none';
  checks.push({
    name: 'sandbox',
    enabled: sandboxEnabled,
    value: sandboxMode,
    recommendation: sandboxEnabled
      ? `Sandbox enabled (${sandboxMode} mode)`
      : 'Enable sandbox: Add { "sandbox": { "mode": "docker" } } to config for isolated testing',
  });
  
  // Check MCPs
  const disabledMcps = config?.disableMcps || [];
  
  checks.push({
    name: 'ast_grep MCP',
    enabled: !disabledMcps.includes('ast_grep'),
    recommendation: !disabledMcps.includes('ast_grep')
      ? 'ast_grep MCP enabled'
      : 'Enable ast_grep: Remove "ast_grep" from disableMcps array',
  });
  
  checks.push({
    name: 'veil MCP',
    enabled: !disabledMcps.includes('veil'),
    recommendation: !disabledMcps.includes('veil')
      ? 'veil MCP enabled'
      : 'Enable veil: Remove "veil" from disableMcps array',
  });
  
  checks.push({
    name: 'pare_search MCP',
    enabled: !disabledMcps.includes('pare_search'),
    recommendation: !disabledMcps.includes('pare_search')
      ? 'pare_search MCP enabled'
      : 'Enable pare_search: Remove "pare_search" from disableMcps array',
  });
  
  return checks;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const hiveDoctorTool: ToolDefinition = tool({
  description: `Hive Doctor - System health check with actionable fixes.

**Checks performed:**
1. Dependencies - All MCP packages, ast-grep, agent-booster, etc.
2. CLI Tools - dora, auto-cr, scip-typescript, veil, btca, etc.
3. Native Binaries - tree-sitter binaries for ast-grep
4. Config - optimizations and MCPs enabled

**Output includes:**
- Status summary (healthy/warning/action-required)
- Missing items with install commands
- Action items prioritized by impact
- Quick install commands for all missing items

**Tip:** Run standalone before installing: \`bunx @hung319/opencode-hive doctor\``,

  args: {},

  async execute() {
    // 1. Check dependencies
    const dependencyChecks = await Promise.all([
      // Core
      checkPackage('@ast-grep/napi'),
      checkPackage('@notprolands/ast-grep-mcp'),
      checkPackage('@paretools/search'),
      // Agent tools
      checkPackage('@sparkleideas/agent-booster'),
      checkPackage('@sparkleideas/memory'),
      // MCPs
      checkPackage('@upstash/context7-mcp'),
      checkPackage('exa-mcp-server'),
      checkPackage('grep-mcp'),
      checkPackage('btca-ask'),
      // Blockchain
      checkPackage('opencode-model-selector'),
      checkPackage('opencode-model-selector-free'),
    ]);
    
    // 2. Check CLI tools
    const cliToolChecks = [
      checkCliTool('dora', '@butttons/dora', 'SCIP-based code navigation'),
      checkCliTool('auto-cr', 'auto-cr-cmd', 'SWC-based automated code review'),
      checkCliTool('scip-typescript', '@sourcegraph/scip-typescript', 'TypeScript SCIP indexer'),
      checkCliTool('veil', '@ushiradineth/veil', 'Code discovery and retrieval'),
      checkCliTool('btca', 'btca-ask', 'BTC/A agent for blockchain tasks'),
      checkCliTool('ast-grep', '@notprolands/ast-grep-mcp', 'AST-based pattern matching'),
    ];
    
    // 3. Check native binaries
    const nativeCheck = checkAstGrepNative();
    const nativeStatus = nativeCheck.available 
      ? 'native' as const
      : 'cli-mode' as const;
    
    // 4. Check config
    const configChecks = checkConfig();
    
    // Calculate status
    const missingDeps = dependencyChecks.filter(d => !d.installed);
    const missingTools = cliToolChecks.filter(t => !t.installed);
    const disabledConfigs = configChecks.filter(c => !c.enabled);
    
    let status: 'healthy' | 'warning' | 'action-required' = 'healthy';
    if (missingTools.length >= 2 || missingDeps.length >= 3) {
      status = 'action-required';
    } else if (missingTools.length >= 1 || missingDeps.length >= 1 || disabledConfigs.length >= 2) {
      status = 'warning';
    }
    
    // Generate action items
    const actionItems: DoctorResult['actionItems'] = [];
    
    // High priority: CLI tools
    for (const tool of missingTools) {
      actionItems.push({
        priority: 'high',
        action: `Install ${tool.name}`,
        command: `npx -y ${tool.command}`,
        reason: `${tool.description} - improves code navigation/review`,
      });
    }
    
    // High priority: MCP deps
    if (!dependencyChecks.find(d => d.package === '@notprolands/ast-grep-mcp')?.installed) {
      actionItems.push({
        priority: 'medium',
        action: 'Install ast-grep MCP for YAML rule testing',
        command: `npm install @notprolands/ast-grep-mcp`,
        reason: 'Full ast-grep functionality with YAML rules',
      });
    }
    
    // Medium priority: Optimizations
    for (const config of disabledConfigs) {
      actionItems.push({
        priority: 'low',
        action: config.recommendation,
        reason: `Enable ${config.name} for better performance/features`,
      });
    }
    
    // Quick install lists
    const quickInstall = {
      deps: missingDeps.map(d => d.package),
      cliTools: missingTools.map(t => t.command),
    };
    
    // Summary strings
    const summary = {
      dependencies: missingDeps.length === 0 
        ? '✅ All dependencies installed' 
        : `⚠️ ${missingDeps.length} missing: ${missingDeps.map(d => d.name).join(', ')}`,
      cliTools: missingTools.length === 0
        ? '✅ All CLI tools available'
        : `⚠️ ${missingTools.length} missing: ${missingTools.map(t => t.name).join(', ')}`,
      nativeBinaries: nativeCheck.available
        ? `✅ Native mode (v${nativeCheck.version || '?'})`
        : `⚡ CLI mode (${nativeCheck.reason || 'native unavailable'})`,
      config: disabledConfigs.length === 0
        ? '✅ All optimizations enabled'
        : `💡 ${disabledConfigs.length} disabled: ${disabledConfigs.map(c => c.name).join(', ')}`,
    };
    
    const result: DoctorResult = {
      status,
      summary,
      details: {
        dependencies: {
          total: dependencyChecks.length,
          installed: dependencyChecks.filter(d => d.installed).length,
          missing: missingDeps,
        },
        cliTools: {
          total: cliToolChecks.length,
          available: cliToolChecks.filter(t => t.installed).length,
          missing: missingTools,
        },
        nativeBinaries: {
          status: nativeStatus,
          reason: nativeCheck.reason,
          astGrep: {
            available: nativeCheck.available,
            version: nativeCheck.version,
          },
        },
        config: configChecks,
      },
      actionItems,
      quickInstall,
    };
    
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Quick check - just status summary
 */
export const hiveDoctorQuickTool: ToolDefinition = tool({
  description: `Quick health status - shows summary without details.

**Returns:**
- healthy: All dependencies and CLI tools available
- warning: Some items missing (not blocking)
- action-required: Multiple items missing (fix recommended)`,

  args: {},

  async execute() {
    const checks = await Promise.all([
      checkPackage('@ast-grep/napi'),
      checkPackage('@sparkleideas/agent-booster'),
      checkCliTool('dora', '@butttons/dora', ''),
      checkCliTool('auto-cr', 'auto-cr-cmd', ''),
    ]);
    
    const missing = checks.filter(c => !c.installed).length;
    
    return JSON.stringify({
      status: missing === 0 ? 'healthy' : missing >= 2 ? 'action-required' : 'warning',
      missingCount: missing,
      runFullCheck: 'Run hive_doctor for detailed analysis and install commands',
    }, null, 2);
  },
});
