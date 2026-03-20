import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import * as fs from 'fs';
import * as path from 'path';

/**
 * Hive Doctor - System health check and optimization advisor
 * 
 * Checks:
 * 1. Dependencies - optional packages installed?
 * 2. Optimizations - features enabled?
 * 3. Recommendations - suggestions for improvements
 */

interface DependencyCheck {
  name: string;
  package: string;
  installed?: boolean;
  version?: string;
  required: boolean;
}

interface OptimizationCheck {
  name: string;
  enabled: boolean;
  recommendation?: string;
}

interface DoctorResult {
  status: 'healthy' | 'warning' | 'issues';
  timestamp: string;
  checks: {
    dependencies: {
      total: number;
      installed: number;
      packages: DependencyCheck[];
    };
    optimizations: {
      total: number;
      enabled: number;
      features: OptimizationCheck[];
    };
  };
  recommendations: string[];
  quickFixes: Array<{
    command: string;
    description: string;
  }>;
}

/**
 * Check if a package is installed in node_modules
 */
async function checkPackage(packageName: string): Promise<{ installed: boolean; version?: string }> {
  try {
    // Try to find package.json of the installed package
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [
        process.cwd(),
        path.join(process.cwd(), 'node_modules'),
        path.join(process.cwd(), 'packages/opencode-hive/node_modules'),
      ],
    });
    
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return { installed: true, version: pkg.version };
    }
  } catch {
    // Package not found
  }
  return { installed: false };
}

/**
 * Check config file for optimizations
 */
function checkOptimizations(): OptimizationCheck[] {
  const checks: OptimizationCheck[] = [];
  
  // Try to read config
  const configPaths = [
    path.join(process.env.HOME || '', '.config/opencode/agent_hive.json'),
    path.join(process.env.HOME || '', '.config/opencode/agent_hive.jsonc'),
  ];
  
  let config: any = null;
  
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(content.replace(/\\/g, '')); // Basic JSONC parsing
        break;
      } catch {
        // Invalid JSON
      }
    }
  }
  
  // Check snip integration
  const snipConfig = config?.snip;
  checks.push({
    name: 'snip',
    enabled: snipConfig?.enabled === true,
    recommendation: !snipConfig?.enabled 
      ? 'Enable snip in config for 60-90% token reduction on shell output' 
      : undefined,
  });
  
  // Check vector memory
  const vectorConfig = config?.vectorMemory;
  checks.push({
    name: 'vectorMemory',
    enabled: vectorConfig?.enabled === true,
    recommendation: !vectorConfig?.enabled 
      ? 'Enable vector memory for semantic search across memories' 
      : undefined,
  });
  
  // Check agent booster
  const boosterConfig = config?.agentBooster;
  checks.push({
    name: 'agentBooster',
    enabled: boosterConfig?.enabled !== false,
    recommendation: boosterConfig?.enabled === false 
      ? 'Enable agent booster for 52x faster code editing' 
      : undefined,
  });
  
  // Check sandbox mode
  const sandboxConfig = config?.sandbox;
  checks.push({
    name: 'sandbox',
    enabled: sandboxConfig !== 'none',
    recommendation: sandboxConfig === 'none' 
      ? 'Enable Docker sandbox for isolated test environments' 
      : undefined,
  });
  
  // Check MCPs
  const disabledMcps = config?.disableMcps || [];
  const hasAstGrep = !disabledMcps.includes('ast_grep');
  checks.push({
    name: 'nativeAstGrep',
    enabled: hasAstGrep,
    recommendation: !hasAstGrep 
      ? 'Enable native ast-grep for fast AST analysis' 
      : undefined,
  });
  
  const hasPareSearch = !disabledMcps.includes('pare_search');
  checks.push({
    name: 'pareSearch',
    enabled: hasPareSearch,
    recommendation: !hasPareSearch 
      ? 'Enable pare_search for structured ripgrep output (65-95% token reduction)' 
      : undefined,
  });
  
  return checks;
}

/**
 * Generate recommendations based on checks
 */
function generateRecommendations(
  dependencies: DependencyCheck[],
  optimizations: OptimizationCheck[]
): string[] {
  const recommendations: string[] = [];
  
  // Missing required dependencies
  const missingRequired = dependencies.filter(d => d.required && !d.installed);
  if (missingRequired.length > 0) {
    recommendations.push(
      `Missing required packages: ${missingRequired.map(d => d.name).join(', ')}`
    );
  }
  
  // Disabled optimizations
  const disabledOptimizations = optimizations.filter(o => !o.enabled && o.recommendation);
  for (const opt of disabledOptimizations) {
    if (opt.recommendation) {
      recommendations.push(opt.recommendation);
    }
  }
  
  // General recommendations
  if (recommendations.length === 0) {
    recommendations.push('System is optimized! No immediate actions needed.');
  }
  
  return recommendations;
}

/**
 * Generate quick fix commands
 */
function generateQuickFixes(
  dependencies: DependencyCheck[],
  optimizations: OptimizationCheck[]
): Array<{ command: string; description: string }> {
  const fixes: Array<{ command: string; description: string }> = [];
  
  // Missing packages
  const missingPackages = dependencies.filter(d => !d.installed && !d.required);
  for (const pkg of missingPackages) {
    fixes.push({
      command: `npm install ${pkg.package}`,
      description: `Install ${pkg.name}`,
    });
  }
  
  // Disabled features
  if (optimizations.find(o => o.name === 'snip' && !o.enabled)) {
    fixes.push({
      command: 'Add to ~/.config/opencode/agent_hive.json: { "snip": { "enabled": true } }',
      description: 'Enable snip for token reduction',
    });
  }
  
  if (optimizations.find(o => o.name === 'vectorMemory' && !o.enabled)) {
    fixes.push({
      command: 'Add to ~/.config/opencode/agent_hive.json: { "vectorMemory": { "enabled": true } }',
      description: 'Enable vector memory for semantic search',
    });
  }
  
  return fixes;
}

/**
 * Calculate overall status
 */
function calculateStatus(
  dependencies: DependencyCheck[],
  optimizations: OptimizationCheck[]
): 'healthy' | 'warning' | 'issues' {
  // Check for missing required packages
  const missingRequired = dependencies.filter(d => d.required && !d.installed);
  if (missingRequired.length > 0) {
    return 'issues';
  }
  
  // Check for too many disabled optimizations
  const disabledCount = optimizations.filter(o => !o.enabled).length;
  if (disabledCount > 2) {
    return 'warning';
  }
  
  return 'healthy';
}

// ============================================================================
// Tool Definition
// ============================================================================

export const hiveDoctorTool: ToolDefinition = tool({
  description: `Hive Doctor - System health check and optimization advisor.

**What it checks:**
1. Dependencies - Optional packages installed and working
2. Optimizations - Features enabled in config
3. Recommendations - Suggestions for improvements

**Use when:**
- Setting up Hive for the first time
- Troubleshooting issues
- Optimizing performance
- Checking if new features are available

**Example output:**
- healthy: All checks pass
- warning: Some optimizations disabled
- issues: Missing required packages`,

  args: {},

  async execute() {
    // Check dependencies
    const dependencyChecks: DependencyCheck[] = [
      { name: 'agent-booster', package: '@sparkleideas/agent-booster', required: false },
      { name: 'vector-memory', package: '@sparkleideas/memory', required: false },
      { name: 'ast-grep NAPI', package: '@ast-grep/napi', required: false },
      { name: 'pare-search', package: '@paretools/search', required: false },
      { name: 'context7', package: '@upstash/context7-mcp', required: false },
      { name: 'Exa search', package: 'exa-mcp-server', required: false },
    ];
    
    for (const dep of dependencyChecks) {
      const result = await checkPackage(dep.package);
      dep.installed = result.installed;
      dep.version = result.version;
    }
    
    // Check optimizations
    const optimizationChecks = checkOptimizations();
    
    // Generate recommendations
    const recommendations = generateRecommendations(dependencyChecks, optimizationChecks);
    const quickFixes = generateQuickFixes(dependencyChecks, optimizationChecks);
    
    // Calculate status
    const status = calculateStatus(dependencyChecks, optimizationChecks);
    
    const result: DoctorResult = {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        dependencies: {
          total: dependencyChecks.length,
          installed: dependencyChecks.filter(d => d.installed).length,
          packages: dependencyChecks,
        },
        optimizations: {
          total: optimizationChecks.length,
          enabled: optimizationChecks.filter(o => o.enabled).length,
          features: optimizationChecks,
        },
      },
      recommendations,
      quickFixes,
    };
    
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Quick check tool - just shows status without details
 */
export const hiveDoctorQuickTool: ToolDefinition = tool({
  description: `Quick health check - shows status summary only.

**Returns:**
- healthy: All systems go
- warning: Some optimizations disabled
- issues: Action required`,

  args: {},

  async execute() {
    // Quick check - just check key packages
    const keyPackages = [
      '@ast-grep/napi',
      '@sparkleideas/agent-booster',
      '@paretools/search',
    ];
    
    const results: Record<string, boolean> = {};
    let healthy = true;
    
    for (const pkg of keyPackages) {
      const result = await checkPackage(pkg);
      results[pkg] = result.installed;
      if (!result.installed) {
        healthy = false;
      }
    }
    
    return JSON.stringify({
      status: healthy ? 'healthy' : 'warning',
      packages: results,
      runFullCheck: 'Use hive_doctor for detailed analysis',
    }, null, 2);
  },
});
