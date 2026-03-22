import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Hive Doctor - System health check
 * 
 * Checks optional agent tools and CLI tools.
 * MCPs are auto-installed with the plugin.
 */

interface CheckResult {
  name: string;
  installed: boolean;
  version?: string;
}

interface CliCheck {
  name: string;
  command: string;
  installed: boolean;
  version?: string;
  description: string;
}

interface DoctorResult {
  status: 'ready' | 'needs-setup' | 'action-required';
  version: string;
  checks: {
    agentTools: {
      total: number;
      installed: number;
      items: CheckResult[];
    };
    cliTools: {
      total: number;
      available: number;
      items: CliCheck[];
    };
  };
  cxxflagsStatus: 'ready' | 'in-config' | 'not-set';
  cxxflagsHint: string;
  actionItems: {
    priority: 'high' | 'medium' | 'low';
    action: string;
    command?: string;
    reason: string;
  }[];
  quickInstall: string;
}

/**
 * Check if a package is installed
 */
async function checkPackage(packageName: string): Promise<CheckResult> {
  const result: CheckResult = {
    name: packageName,
    installed: false,
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
function checkCliTool(name: string, command: string, description: string): CliCheck {
  const result: CliCheck = {
    name,
    command,
    installed: false,
    description,
  };
  
  try {
    execSync(command.split(' ')[0], { stdio: 'pipe', timeout: 3000 });
    result.installed = true;
    result.version = 'installed';
  } catch {
    try {
      execSync(`npx -y ${command.split(' ')[0]} --version`, { stdio: 'pipe', timeout: 5000 });
      result.installed = true;
      result.version = 'via npx';
    } catch {}
  }
  
  return result;
}

/**
 * Check if CXXFLAGS is set
 */
function checkCxxFlags(): { inConfig: boolean; inSession: boolean } {
  const configs = [
    path.join(process.env.HOME || '', '.bashrc'),
    path.join(process.env.HOME || '', '.zshrc'),
  ];
  
  let inConfig = false;
  for (const config of configs) {
    if (fs.existsSync(config)) {
      const content = fs.readFileSync(config, 'utf-8');
      if (content.includes('CXXFLAGS')) {
        inConfig = true;
        break;
      }
    }
  }
  
  const inSession = !!process.env.CXXFLAGS;
  
  return { inConfig, inSession };
}

// ============================================================================
// Tool Definition
// ============================================================================

export const hiveDoctorTool: ToolDefinition = tool({
  description: `Hive Doctor - System health check for Hive plugin.

**Checks:**
1. Agent Tools (optional): agent-booster, memory
2. CLI Tools (optional): dora, auto-cr, btca
3. C++20 config: For @ast-grep/napi native modules

**Status:**
- ready: All good
- needs-setup: Some optional tools missing
- action-required: Multiple tools missing

**Tip:** Run standalone for auto-fix: \`bunx @hung319/opencode-hive doctor --fix\``,

  args: {},

  async execute() {
    const cxxflags = checkCxxFlags();
    
    const result: DoctorResult = {
      status: 'ready',
      version: '1.7.2',
      checks: {
        agentTools: { total: 0, installed: 0, items: [] },
        cliTools: { total: 0, available: 0, items: [] },
      },
      cxxflagsStatus: cxxflags.inSession ? 'ready' : cxxflags.inConfig ? 'in-config' : 'not-set',
      cxxflagsHint: cxxflags.inSession ? 'Active in session' 
        : cxxflags.inConfig ? 'Run: source ~/.bashrc' 
        : 'Run: bunx @hung319/opencode-hive doctor --fix',
      actionItems: [],
      quickInstall: '',
    };
    
    // Check agent tools
    const agentTools = await Promise.all([
      checkPackage('@sparkleideas/agent-booster'),
      checkPackage('@sparkleideas/memory'),
    ]);
    
    result.checks.agentTools.items = agentTools;
    result.checks.agentTools.total = agentTools.length;
    result.checks.agentTools.installed = agentTools.filter(t => t.installed).length;
    
    // Check CLI tools
    const cliTools = [
      checkCliTool('dora', '@butttons/dora', 'SCIP-based code navigation'),
      checkCliTool('auto-cr', 'auto-cr-cmd', 'SWC-based code review'),
      checkCliTool('btca', 'btca', 'BTC/A blockchain agent'),
    ];
    
    result.checks.cliTools.items = cliTools;
    result.checks.cliTools.total = cliTools.length;
    result.checks.cliTools.available = cliTools.filter(t => t.installed).length;
    
    // Generate action items
    const missingTools = cliTools.filter(t => !t.installed);
    const missingAgent = agentTools.filter(t => !t.installed);
    
    if (missingTools.length > 0) {
      result.actionItems.push({
        priority: 'high',
        action: 'Install CLI tools',
        command: missingTools.map(t => `npx -y ${t.command}`).join(' && '),
        reason: 'CLI tools enhance code navigation and review',
      });
    }
    
    if (missingAgent.length > 0) {
      result.actionItems.push({
        priority: 'medium',
        action: 'Install agent tools',
        command: missingAgent.map(t => `npm install ${t.name}`).join(' && '),
        reason: 'Agent tools provide faster editing and memory',
      });
    }
    
    if (result.cxxflagsStatus !== 'ready') {
      result.actionItems.push({
        priority: 'low',
        action: 'Enable C++20 for native modules',
        command: `bunx @hung319/opencode-hive doctor --fix`,
        reason: 'Required for @ast-grep/napi tree-sitter build',
      });
    }
    
    // Quick install
    const allCommands: string[] = [];
    for (const tool of missingTools) {
      allCommands.push(`npx -y ${tool.command}`);
    }
    for (const agent of missingAgent) {
      allCommands.push(`npm install ${agent.name}`);
    }
    result.quickInstall = allCommands.join(' && ');
    
    // Status
    if (missingTools.length >= 3) {
      result.status = 'action-required';
    } else if (missingTools.length > 0 || missingAgent.length > 0) {
      result.status = 'needs-setup';
    }
    
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Quick check - just status summary
 */
export const hiveDoctorQuickTool: ToolDefinition = tool({
  description: `Quick health status - shows summary only.

**Returns:**
- ready: All optional tools installed
- needs-setup: Some tools missing (recommended)
- action-required: Multiple tools missing`,

  args: {},

  async execute() {
    const checks = await Promise.all([
      checkPackage('@sparkleideas/agent-booster'),
      checkCliTool('dora', '@butttons/dora', ''),
      checkCliTool('auto-cr', 'auto-cr-cmd', ''),
    ]);
    
    const missing = checks.filter(c => !c.installed).length;
    
    return JSON.stringify({
      status: missing === 0 ? 'ready' : missing >= 2 ? 'action-required' : 'needs-setup',
      missingCount: missing,
      autoFix: 'Run standalone: bunx @hung319/opencode-hive doctor --fix',
    }, null, 2);
  },
});
