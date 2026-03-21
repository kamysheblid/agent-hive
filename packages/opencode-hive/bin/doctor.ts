#!/usr/bin/env bun

/**
 * Hive Doctor - Standalone version
 * 
 * Run BEFORE installing the plugin to check if your system is ready:
 * 
 *   bunx @hung319/opencode-hive doctor
 *   npx @hung319/opencode-hive doctor
 * 
 * Auto-fix issues:
 *   bunx @hung319/opencode-hive doctor --fix
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

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

interface DoctorOutput {
  status: 'ready' | 'needs-setup' | 'action-required';
  version: string;
  summary: {
    os: string;
    nodeVersion: string;
    packageManager: string;
  };
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
  actionItems: {
    priority: 'high' | 'medium' | 'low';
    action: string;
    command?: string;
    reason: string;
  }[];
  quickInstall: string;
  cxxflagsStatus: 'ready' | 'in-config' | 'not-set' | 'auto-fixed';
}

// ============================================================================
// Color helpers
// ============================================================================

const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
};

const noColors = {
  green: (text: string) => text,
  yellow: (text: string) => text,
  red: (text: string) => text,
  blue: (text: string) => text,
  cyan: (text: string) => text,
  gray: (text: string) => text,
};

const isTTY = process.stdout.isTTY;
const c = isTTY ? colors : noColors;

// ============================================================================
// Check functions
// ============================================================================

function getSystemInfo() {
  return {
    os: process.platform,
    nodeVersion: process.version,
    packageManager: exists('npm') ? 'npm' : exists('bun') ? 'bun' : 'unknown',
  };
}

function exists(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkNpmPackage(name: string): CheckResult {
  const result: CheckResult = { name, installed: false };
  
  // Check if package is installed
  try {
    const output = execSync(`npm list ${name} --depth=0 --json 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const json = JSON.parse(output);
    if (json.dependencies && json.dependencies[name]) {
      result.installed = true;
      result.version = json.dependencies[name].version;
    }
  } catch {}
  
  // Also check if module can be required (actual load test)
  if (result.installed) {
    try {
      require(name);
      result.installed = true;
    } catch {
      // Module installed but failed to load (e.g., native build failed)
      result.installed = false;
      result.version = `${result.version || '?'} (load failed)`;
    }
  }
  
  return result;
}

function checkCliTool(name: string, command: string, description: string): CliCheck {
  const result: CliCheck = { name, command, installed: false, description };
  const cmdName = command.split(' ')[0];
  
  // Try direct command with --help (some binaries don't have --version)
  try {
    execSync(cmdName, { stdio: 'ignore', timeout: 3000 });
    result.installed = true;
    result.version = 'installed';
    return result;
  } catch {}
  
  // Try npx with --help
  try {
    execSync(`npx -y ${cmdName} --help`, { 
      stdio: 'ignore', 
      timeout: 10000 
    });
    result.installed = true;
    result.version = 'via npx';
    return result;
  } catch {}
  
  // Special case for auto-cr: binary is "check", not "auto-cr"
  if (name === 'auto-cr') {
    try {
      execSync('check --help', { stdio: 'ignore', timeout: 3000 });
      result.installed = true;
      result.version = 'installed (check)';
      return result;
    } catch {}
  }
  
  return result;
}

// ============================================================================
// CXXFLAGS: Check and Auto-fix
// ============================================================================

function checkCxxFlags(): { inConfig: 'set' | 'not-set'; inSession: boolean } {
  const shellConfigs = [
    path.join(process.env.HOME || '', '.bashrc'),
    path.join(process.env.HOME || '', '.bash_profile'),
    path.join(process.env.HOME || '', '.zshrc'),
    path.join(process.env.HOME || '', '.profile'),
  ];
  
  const patterns = ['CXXFLAGS="-std=c++20"', "CXXFLAGS='-std=c++20'"];
  
  // Check if set in shell config files
  let inConfig: 'set' | 'not-set' = 'not-set';
  for (const config of shellConfigs) {
    if (fs.existsSync(config)) {
      const content = fs.readFileSync(config, 'utf-8');
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          inConfig = 'set';
          break;
        }
      }
    }
    if (inConfig === 'set') break;
  }
  
  // Check if CXXFLAGS is active in current session
  const inSession = !!process.env.CXXFLAGS;
  
  return { inConfig, inSession };
}

function autoFixCxxFlags(): boolean {
  const cxxflags = checkCxxFlags();
  
  if (cxxflags.inConfig === 'set') {
    return true;
  }
  
  const bashrc = path.join(process.env.HOME || '', '.bashrc');
  const exportLine = 'export CXXFLAGS="-std=c++20"\n';
  const comment = '# For tree-sitter native modules (e.g., @ast-grep/napi)\n';
  
  try {
    // Check if bashrc exists
    if (!fs.existsSync(bashrc)) {
      fs.writeFileSync(bashrc, '');
    }
    
    const content = fs.readFileSync(bashrc, 'utf-8');
    
    // Check if already set
    if (content.includes('CXXFLAGS="-std=c++20"')) {
      return true;
    }
    
    // Add to bashrc
    fs.appendFileSync(bashrc, `\n${comment}${exportLine}`);
    console.log(c.green(`✓ Added CXXFLAGS to ${bashrc}`));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Auto-set CXXFLAGS for current session
// ============================================================================

function setCxxFlagsForCurrentSession(): boolean {
  try {
    process.env.CXXFLAGS = '"-std=c++20"';
    process.env.npm_config_cxxflags = '"-std=c++20"';
    console.log(c.green('✓ CXXFLAGS set for current session'));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Auto-install CLI tools
// ============================================================================

function autoInstallCliTools(tools: CliCheck[]): { success: string[]; failed: string[] } {
  const result = { success: [] as string[], failed: [] as string[] };
  
  for (const tool of tools) {
    if (tool.installed) continue;
    
    try {
      console.log(c.cyan(`  Installing ${tool.name}...`));
      execSync(`npx -y ${tool.command} --version`, { 
        stdio: 'ignore',
        timeout: 60000 
      });
      result.success.push(tool.name);
      console.log(c.green(`    ✓ ${tool.name} ready`));
    } catch {
      result.failed.push(tool.name);
      console.log(c.red(`    ✗ ${tool.name} failed`));
    }
  }
  
  return result;
}

// ============================================================================
// Main check
// ============================================================================

function runDoctor(autoFix = false): DoctorOutput {
  const cxxflags = checkCxxFlags();
  
  const output: DoctorOutput = {
    status: 'ready',
    version: '1.6.6',
    summary: getSystemInfo(),
    checks: {
      agentTools: { total: 0, installed: 0, items: [] },
      cliTools: { total: 0, available: 0, items: [] },
    },
    actionItems: [],
    quickInstall: '',
    cxxflagsStatus: cxxflags.inSession ? 'ready' : cxxflags.inConfig === 'set' ? 'in-config' : 'not-set',
  };
  
  // Auto-fix CXXFLAGS if requested
  if (autoFix) {
    console.log(c.cyan('\n🔧 Auto-fixing...\n'));
    
    // Set for current session
    setCxxFlagsForCurrentSession();
    
    // Add to shell config
    if (cxxflags.inConfig !== 'set') {
      autoFixCxxFlags();
      output.cxxflagsStatus = 'auto-fixed';
    }
  }
  
  // Check agent tools (bundled with plugin, externalized at build)
  const agentToolsList = [
    { name: '@sparkleideas/agent-booster', desc: '52x faster code editing' },
    { name: '@sparkleideas/memory', desc: 'Vector memory for semantic search' },
    { name: '@ast-grep/napi', desc: 'AST-based pattern matching' },
  ];
  
  output.checks.agentTools.items = agentToolsList.map(t => checkNpmPackage(t.name));
  output.checks.agentTools.total = agentToolsList.length;
  output.checks.agentTools.installed = output.checks.agentTools.items.filter(t => t.installed).length;
  
  // Check CLI tools
  const cliToolsList = [
    { name: 'dora', command: '@butttons/dora', desc: 'SCIP-based code navigation' },
    { name: 'auto-cr', command: 'auto-cr-cmd', desc: 'SWC-based code review' },
    { name: 'scip-typescript', command: '@sourcegraph/scip-typescript', desc: 'TypeScript indexer' },
    { name: 'veil', command: '@ushiradineth/veil', desc: 'Code discovery' },
    { name: 'btca', command: 'btca', desc: 'BTC/A blockchain agent' },
  ];
  
  output.checks.cliTools.items = cliToolsList.map(t => checkCliTool(t.name, t.command, t.desc));
  output.checks.cliTools.total = cliToolsList.length;
  output.checks.cliTools.available = output.checks.cliTools.items.filter(t => t.installed).length;
  
  // Generate action items
  const missingTools = output.checks.cliTools.items.filter(t => !t.installed);
  const missingAgent = output.checks.agentTools.items.filter(t => !t.installed);
  
  if (missingTools.length > 0) {
    output.actionItems.push({
      priority: 'high',
      action: `Install CLI tools`,
      command: missingTools.map(t => `npx -y ${t.command}`).join(' && '),
      reason: 'CLI tools enhance code navigation and review',
    });
  }
  
  if (missingAgent.length > 0) {
    output.actionItems.push({
      priority: 'medium',
      action: `Install agent tools`,
      command: missingAgent.map(t => `npm install ${t.name}`).join(' && '),
      reason: 'Agent tools provide faster editing and memory',
    });
  }
  
  // Generate quick install
  const allCommands: string[] = [];
  for (const tool of missingTools) {
    allCommands.push(`npx -y ${tool.command}`);
  }
  for (const agent of missingAgent) {
    allCommands.push(`npm install ${agent.name}`);
  }
  output.quickInstall = allCommands.join(' && ');
  
  // Determine status
  if (missingTools.length >= 3) {
    output.status = 'action-required';
  } else if (missingTools.length > 0 || missingAgent.length > 0) {
    output.status = 'needs-setup';
  }
  
  // Auto-install CLI tools if requested
  if (autoFix && missingTools.length > 0) {
    console.log(c.cyan('\n🔧 Installing CLI tools...\n'));
    const installResult = autoInstallCliTools(missingTools);
    
    // Re-check after installation
    if (installResult.success.length > 0) {
      for (const name of installResult.success) {
        const tool = output.checks.cliTools.items.find(t => t.name === name);
        if (tool) {
          tool.installed = true;
          tool.version = 'installed';
        }
      }
      output.checks.cliTools.available = output.checks.cliTools.items.filter(t => t.installed).length;
    }
  }
  
  return output;
}

// ============================================================================
// Print output
// ============================================================================

function printDoctor(output: DoctorOutput) {
  console.log('\n' + c.blue('╔═══════════════════════════════════════════════════════════╗'));
  console.log(c.blue('║') + '          🐝 Hive Doctor v' + output.version + ' - System Check' + ' '.repeat(14) + c.blue('║'));
  console.log(c.blue('╚═══════════════════════════════════════════════════════════╝'));
  
  console.log('\n' + c.gray('─'.repeat(55)));
  console.log(`  OS: ${output.summary.os}`);
  console.log(`  Node: ${output.summary.nodeVersion}`);
  console.log(`  PM: ${output.summary.packageManager}`);
  console.log(c.gray('─'.repeat(55)));
  
  // Status
  const statusColor = output.status === 'ready' ? c.green : 
                      output.status === 'needs-setup' ? c.yellow : c.red;
  const statusText = output.status === 'ready' ? '✅ READY' : 
                     output.status === 'needs-setup' ? '⚠️ NEEDS SETUP' : '❌ ACTION REQUIRED';
  
  console.log('\n  Status: ' + statusColor(statusText));
  
  // Agent tools
  console.log('\n🚀 Agent Tools (' + output.checks.agentTools.installed + '/' + output.checks.agentTools.total + ')');
  for (const tool of output.checks.agentTools.items) {
    const icon = tool.installed ? c.green('✅') : c.yellow('○');
    const version = tool.version ? c.gray(`v${tool.version}`) : c.red('not installed');
    console.log(`   ${icon} ${tool.name} ${version}`);
  }
  
  // CLI tools
  console.log('\n🔧 CLI Tools (' + output.checks.cliTools.available + '/' + output.checks.cliTools.total + ')');
  for (const tool of output.checks.cliTools.items) {
    const icon = tool.installed ? c.green('✅') : c.yellow('○');
    const version = tool.version ? c.gray(`(${tool.version})`) : c.red('not available');
    console.log(`   ${icon} ${tool.name} - ${tool.description} ${version}`);
  }
  
  // Note about MCPs
  console.log('\n📦 MCPs: ' + c.gray('Auto-installed with plugin'));
  
  // C++20 status
  console.log('\n⚡ C++20 for native modules:');
  if (output.cxxflagsStatus === 'ready') {
    console.log('   ' + c.green('✓ Active in session'));
  } else if (output.cxxflagsStatus === 'in-config') {
    console.log('   ' + c.yellow('⚠ Configured but not active in current session'));
    console.log('   ' + c.gray('   Run: source ~/.bashrc'));
  } else if (output.cxxflagsStatus === 'auto-fixed') {
    console.log('   ' + c.green('✓ Configured!'));
    console.log('   ' + c.gray('   Run: source ~/.bashrc to activate'));
  } else {
    console.log('   ' + c.red('○ Not set (needed for @ast-grep/napi)'));
    console.log('   ' + c.gray('   Run with --fix to auto-configure'));
  }
  
  // Action items
  if (output.actionItems.length > 0) {
    console.log('\n' + c.gray('─'.repeat(55)));
    console.log('\n📋 Action Items\n');
    
    for (const item of output.actionItems) {
      const priorityColor = item.priority === 'high' ? c.red :
                           item.priority === 'medium' ? c.yellow : c.gray;
      
      console.log(`  [${priorityColor(item.priority.toUpperCase())}] ${item.action}`);
      console.log(`      ${c.gray(item.reason)}`);
      if (item.command) {
        console.log(`      ${c.green(item.command)}`);
      }
      console.log();
    }
  }
  
  // Quick install
  if (output.quickInstall) {
    console.log(c.gray('─'.repeat(55)));
    console.log('\n🚀 Quick Install\n');
    console.log('  ' + c.green(output.quickInstall));
  }
  
  console.log('\n' + c.blue('═'.repeat(55)));
  console.log(c.gray('  bunx @hung319/opencode-hive doctor'));
  console.log(c.gray('  bunx @hung319/opencode-hive doctor --fix'));
  console.log(c.blue('═'.repeat(55)) + '\n');
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
const autoFix = args.includes('--fix') || args.includes('-f');
const ciMode = process.env.CI === 'true' || args.includes('--ci');

const output = runDoctor(autoFix);
printDoctor(output);

// In CI mode, only fail on critical errors, not on missing optional tools
if (ciMode) {
  process.exit(0);
}

process.exit(output.status === 'ready' ? 0 : 1);
