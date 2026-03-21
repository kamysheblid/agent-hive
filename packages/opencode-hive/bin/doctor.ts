#!/usr/bin/env bun

/**
 * Hive Doctor - Standalone version
 * 
 * Run BEFORE installing the plugin to check if your system is ready:
 * 
 *   bunx @hung319/opencode-hive doctor
 *   npx @hung319/opencode-hive doctor
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
  
  return result;
}

function checkCliTool(name: string, command: string, description: string): CliCheck {
  const result: CliCheck = { name, command, installed: false, description };
  
  // Try direct command
  try {
    const cmd = command.split(' ')[0];
    execSync(cmd, { stdio: 'ignore', timeout: 3000 });
    result.installed = true;
    result.version = 'installed';
    return result;
  } catch {}
  
  // Try npx
  try {
    execSync(`npx -y ${command.split(' ')[0]} --version`, { 
      stdio: 'ignore', 
      timeout: 10000 
    });
    result.installed = true;
    result.version = 'via npx';
    return result;
  } catch {}
  
  return result;
}

// ============================================================================
// Auto-fix: Add CXXFLAGS to shell config
// ============================================================================

function ensureCxxFlags(): boolean {
  const cxxflag = 'CXXFLAGS="-std=c++20"';
  const exportLine = `export ${cxxflag}`;
  
  // Check if already set
  const shellConfigs = [
    path.join(process.env.HOME || '', '.bashrc'),
    path.join(process.env.HOME || '', '.zshrc'),
    path.join(process.env.HOME || '', '.profile'),
  ];
  
  for (const config of shellConfigs) {
    if (fs.existsSync(config)) {
      const content = fs.readFileSync(config, 'utf-8');
      if (content.includes(cxxflag) || content.includes(exportLine)) {
        return true; // Already set
      }
    }
  }
  
  // Try to add to ~/.bashrc
  const bashrc = path.join(process.env.HOME || '', '.bashrc');
  try {
    fs.appendFileSync(bashrc, `\n# For tree-sitter native modules (e.g., @ast-grep/napi)\n${exportLine}\n`);
    console.log(colors.green(`✓ Added ${exportLine} to ~/.bashrc`));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Main check
// ============================================================================

function runDoctor(): DoctorOutput {
  const output: DoctorOutput = {
    status: 'ready',
    version: '1.6.3',
    summary: getSystemInfo(),
    checks: {
      agentTools: { total: 0, installed: 0, items: [] },
      cliTools: { total: 0, available: 0, items: [] },
    },
    actionItems: [],
    quickInstall: '',
  };
  
  // Check optional agent tools
  const agentTools = [
    { name: '@sparkleideas/agent-booster', desc: '52x faster code editing' },
    { name: '@sparkleideas/memory', desc: 'Vector memory for semantic search' },
  ];
  
  output.checks.agentTools.items = agentTools.map(t => {
    const result = checkNpmPackage(t.name);
    return result;
  });
  output.checks.agentTools.total = agentTools.length;
  output.checks.agentTools.installed = output.checks.agentTools.items.filter(t => t.installed).length;
  
  // Check CLI tools
  const cliTools = [
    { name: 'dora', command: '@butttons/dora', desc: 'SCIP-based code navigation' },
    { name: 'auto-cr', command: 'auto-cr-cmd', desc: 'SWC-based code review' },
    { name: 'scip-typescript', command: '@sourcegraph/scip-typescript', desc: 'TypeScript indexer' },
    { name: 'veil', command: '@ushiradineth/veil', desc: 'Code discovery' },
    { name: 'btca', command: 'btca', desc: 'BTC/A blockchain agent' },
  ];
  
  output.checks.cliTools.items = cliTools.map(t => checkCliTool(t.name, t.command, t.desc));
  output.checks.cliTools.total = cliTools.length;
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
  
  return output;
}

// ============================================================================
// Print output
// ============================================================================

function printDoctor(output: DoctorOutput) {
  console.log('\n' + colors.blue('╔═══════════════════════════════════════════════════════════╗'));
  console.log(colors.blue('║') + '          🐝 Hive Doctor v' + output.version + ' - System Check' + ' '.repeat(14) + colors.blue('║'));
  console.log(colors.blue('╚═══════════════════════════════════════════════════════════╝'));
  
  console.log('\n' + colors.gray('─'.repeat(55)));
  console.log(`  OS: ${output.summary.os}`);
  console.log(`  Node: ${output.summary.nodeVersion}`);
  console.log(`  PM: ${output.summary.packageManager}`);
  console.log(colors.gray('─'.repeat(55)));
  
  // Status
  const statusColor = output.status === 'ready' ? colors.green : 
                      output.status === 'needs-setup' ? colors.yellow : colors.red;
  const statusText = output.status === 'ready' ? '✅ READY' : 
                     output.status === 'needs-setup' ? '⚠️ NEEDS SETUP' : '❌ ACTION REQUIRED';
  
  console.log('\n  Status: ' + statusColor(statusText));
  
  // Agent tools
  console.log('\n🚀 Agent Tools (' + output.checks.agentTools.installed + '/' + output.checks.agentTools.total + ')');
  for (const tool of output.checks.agentTools.items) {
    const icon = tool.installed ? colors.green('✅') : colors.yellow('○');
    const version = tool.version ? colors.gray(`v${tool.version}`) : colors.red('not installed');
    console.log(`   ${icon} ${tool.name} ${version}`);
  }
  
  // CLI tools
  console.log('\n🔧 CLI Tools (' + output.checks.cliTools.available + '/' + output.checks.cliTools.total + ')');
  for (const tool of output.checks.cliTools.items) {
    const icon = tool.installed ? colors.green('✅') : colors.yellow('○');
    const version = tool.version ? colors.gray(`(${tool.version})`) : colors.red('not available');
    console.log(`   ${icon} ${tool.name} - ${tool.description} ${version}`);
  }
  
  // Note about MCPs
  console.log('\n📦 MCPs: ' + colors.gray('Auto-installed with plugin'));
  
  // C++20 tip
  console.log('\n' + colors.cyan('💡 Tip: ') + colors.gray('Enable C++20 for native modules?'));
  const shellConfigs = [
    path.join(process.env.HOME || '', '.bashrc'),
    path.join(process.env.HOME || '', '.zshrc'),
  ];
  let cxxflagsSet = false;
  for (const config of shellConfigs) {
    if (fs.existsSync(config)) {
      const content = fs.readFileSync(config, 'utf-8');
      if (content.includes('CXXFLAGS="-std=c++20"')) {
        cxxflagsSet = true;
        break;
      }
    }
  }
  
  if (!cxxflagsSet) {
    console.log('   ' + colors.yellow('Not detected. Run to fix @ast-grep/napi build:'));
    console.log('   ' + colors.green('echo \'export CXXFLAGS="-std=c++20"\' >> ~/.bashrc'));
  } else {
    console.log('   ' + colors.green('✓ Already configured'));
  }
  
  // Action items
  if (output.actionItems.length > 0) {
    console.log('\n' + colors.gray('─'.repeat(55)));
    console.log('\n📋 Action Items\n');
    
    for (const item of output.actionItems) {
      const priorityColor = item.priority === 'high' ? colors.red :
                           item.priority === 'medium' ? colors.yellow : colors.gray;
      
      console.log(`  [${priorityColor(item.priority.toUpperCase())}] ${item.action}`);
      console.log(`      ${colors.gray(item.reason)}`);
      if (item.command) {
        console.log(`      ${colors.green(item.command)}`);
      }
      console.log();
    }
  }
  
  // Quick install
  if (output.quickInstall) {
    console.log(colors.gray('─'.repeat(55)));
    console.log('\n🚀 Quick Install\n');
    console.log('  ' + colors.green(output.quickInstall));
  }
  
  console.log('\n' + colors.blue('═'.repeat(55)));
  console.log(colors.gray('  Run with: bunx @hung319/opencode-hive doctor'));
  console.log(colors.blue('═'.repeat(55)) + '\n');
}

// ============================================================================
// Main
// ============================================================================

const output = runDoctor();
printDoctor(output);

process.exit(output.status === 'ready' ? 0 : 1);
