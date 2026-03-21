#!/usr/bin/env bun

/**
 * Hive Doctor - Standalone version
 * 
 * Run BEFORE installing the plugin to check if your system is ready:
 * 
 *   bunx @hung319/opencode-hive doctor
 *   npx @hung319/opencode-hive doctor
 * 
 * Or install and run:
 * 
 *   npm install @hung319/opencode-hive
 *   hive_doctor()  // via OpenCode
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
  reason?: string;
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
    dependencies: {
      total: number;
      installed: number;
      items: CheckResult[];
    };
    cliTools: {
      total: number;
      available: number;
      items: CliCheck[];
    };
    nativeBinaries: {
      status: 'native' | 'cli-mode';
      reason?: string;
    };
    config: {
      exists: boolean;
      path?: string;
      optimizations: string[];
    };
  };
  actionItems: {
    priority: 'critical' | 'high' | 'medium' | 'low';
    action: string;
    command?: string;
    reason: string;
  }[];
  installCommands: {
    deps: string;
    cliTools: string;
  };
}

// ============================================================================
// Color helpers
// ============================================================================

const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
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

function checkAstGrepNative(): { status: 'native' | 'cli-mode'; reason?: string } {
  // Check if @ast-grep/napi package exists with native binaries
  const napiDirs = [
    path.join(process.cwd(), 'node_modules/@ast-grep/napi'),
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/@ast-grep/napi'),
  ];
  
  for (const napiDir of napiDirs) {
    if (!fs.existsSync(napiDir)) continue;
    
    const binaryPaths = [
      path.join(napiDir, 'index.node'),
      path.join(napiDir, 'build/Release/ast_grep.node'),
      path.join(napiDir, 'dist/index.node'),
    ];
    
    const hasBinary = binaryPaths.some(p => fs.existsSync(p));
    
    if (hasBinary) {
      return { status: 'native' };
    }
  }
  
  return { 
    status: 'cli-mode',
    reason: 'Native binaries not found (tree-sitter compilation may have failed)'
  };
}

function checkConfig(): { exists: boolean; path?: string; optimizations: string[] } {
  const configPaths = [
    path.join(process.env.HOME || '', '.config/opencode/agent_hive.json'),
    path.join(process.env.HOME || '', '.config/opencode/agent_hive.jsonc'),
  ];
  
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content.replace(/\\/g, ''));
        const optimizations: string[] = [];
        
        if (config.snip?.enabled) optimizations.push('snip');
        if (config.vectorMemory?.enabled) optimizations.push('vectorMemory');
        if (config.agentBooster?.enabled !== false) optimizations.push('agentBooster');
        if (config.sandbox?.mode !== 'none') optimizations.push('sandbox');
        
        return { exists: true, path: configPath, optimizations };
      } catch {}
    }
  }
  
  return { exists: false, optimizations: [] };
}

// ============================================================================
// Main check
// ============================================================================

function runDoctor(): DoctorOutput {
  const output: DoctorOutput = {
    status: 'ready',
    version: '1.5.8',
    summary: getSystemInfo(),
    checks: {
      dependencies: { total: 0, installed: 0, items: [] },
      cliTools: { total: 0, available: 0, items: [] },
      nativeBinaries: { status: 'cli-mode' },
      config: { exists: false, optimizations: [] },
    },
    actionItems: [],
    installCommands: { deps: '', cliTools: '' },
  };
  
  // Check dependencies
  const deps = [
    '@ast-grep/napi',
    '@notprolands/ast-grep-mcp',
    '@sparkleideas/agent-booster',
    '@sparkleideas/memory',
    '@paretools/search',
    '@upstash/context7-mcp',
    'exa-mcp-server',
    'grep-mcp',
    'btca-ask',
    'opencode-model-selector',
  ];
  
  output.checks.dependencies.items = deps.map(d => checkNpmPackage(d));
  output.checks.dependencies.total = deps.length;
  output.checks.dependencies.installed = output.checks.dependencies.items.filter(d => d.installed).length;
  
  // Check CLI tools
  const cliTools = [
    { name: 'dora', command: '@butttons/dora', description: 'SCIP-based code navigation' },
    { name: 'auto-cr', command: 'auto-cr-cmd', description: 'SWC-based automated code review' },
    { name: 'veil', command: '@ushiradineth/veil', description: 'Code discovery and retrieval' },
    { name: 'scip-typescript', command: '@sourcegraph/scip-typescript', description: 'TypeScript SCIP indexer' },
    { name: 'btca', command: 'btca-ask', description: 'BTC/A agent for blockchain tasks' },
    { name: 'ast-grep', command: '@notprolands/ast-grep-mcp', description: 'AST-based pattern matching' },
  ];
  
  output.checks.cliTools.items = cliTools.map(t => checkCliTool(t.name, t.command, t.description));
  output.checks.cliTools.total = cliTools.length;
  output.checks.cliTools.available = output.checks.cliTools.items.filter(t => t.installed).length;
  
  // Check native binaries
  output.checks.nativeBinaries = checkAstGrepNative();
  
  // Check config
  output.checks.config = checkConfig();
  
  // Generate action items
  const missingDeps = output.checks.dependencies.items.filter(d => !d.installed);
  const missingTools = output.checks.cliTools.items.filter(t => !t.installed);
  
  if (missingTools.length > 0) {
    output.actionItems.push({
      priority: 'high',
      action: `Install ${missingTools.length} CLI tool(s)`,
      command: missingTools.map(t => `npx -y ${t.command}`).join(' && '),
      reason: 'CLI tools provide code navigation, review, and analysis features',
    });
  }
  
  if (missingDeps.length > 0) {
    const important = missingDeps.filter(d => 
      ['@ast-grep/napi', '@notprolands/ast-grep-mcp', '@paretools/search'].includes(d.name)
    );
    
    if (important.length > 0) {
      output.actionItems.push({
        priority: 'medium',
        action: `Install ${important.length} important package(s)`,
        command: important.map(d => `npm install ${d.name}`).join(' && '),
        reason: 'These packages enable core functionality',
      });
    }
  }
  
  if (!output.checks.config.exists) {
    output.actionItems.push({
      priority: 'low',
      action: 'Create config file',
      command: `mkdir -p ~/.config/opencode && cat > ~/.config/opencode/agent_hive.json << 'EOF'\n{\n  "snip": { "enabled": true },\n  "vectorMemory": { "enabled": true }\n}\nEOF`,
      reason: 'Enable optimizations for better performance',
    });
  }
  
  // Generate install commands
  if (missingDeps.length > 0) {
    output.installCommands.deps = `npm install ${missingDeps.map(d => d.name).join(' ')}`;
  }
  
  if (missingTools.length > 0) {
    output.installCommands.cliTools = `npx -y ${missingTools.map(t => t.command.split(' ')[0]).join(' ')}`;
  }
  
  // Determine status
  if (output.actionItems.some(a => a.priority === 'critical')) {
    output.status = 'action-required';
  } else if (output.actionItems.some(a => a.priority === 'high' || a.priority === 'medium')) {
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
  
  // Summary
  console.log('\n' + colors.gray('─'.repeat(55)));
  console.log(`  OS: ${output.summary.os}`);
  console.log(`  Node: ${output.summary.nodeVersion}`);
  console.log(`  Package Manager: ${output.summary.packageManager}`);
  console.log(colors.gray('─'.repeat(55)));
  
  // Status
  const statusColor = output.status === 'ready' ? colors.green : 
                      output.status === 'needs-setup' ? colors.yellow : colors.red;
  const statusText = output.status === 'ready' ? '✅ READY' : 
                     output.status === 'needs-setup' ? '⚠️ NEEDS SETUP' : '❌ ACTION REQUIRED';
  
  console.log('\n  Status: ' + statusColor(statusText));
  
  // Dependencies
  console.log('\n📦 Dependencies (' + output.checks.dependencies.installed + '/' + output.checks.dependencies.total + ')');
  for (const dep of output.checks.dependencies.items) {
    const icon = dep.installed ? colors.green('✅') : colors.yellow('○');
    const version = dep.version ? colors.gray(`v${dep.version}`) : colors.red('not installed');
    console.log(`   ${icon} ${dep.name} ${version}`);
  }
  
  // CLI Tools
  console.log('\n🔧 CLI Tools (' + output.checks.cliTools.available + '/' + output.checks.cliTools.total + ')');
  for (const tool of output.checks.cliTools.items) {
    const icon = tool.installed ? colors.green('✅') : colors.yellow('○');
    const version = tool.version ? colors.gray(`(${tool.version})`) : colors.red('not available');
    console.log(`   ${icon} ${tool.name} - ${tool.description} ${version}`);
  }
  
  // Native binaries
  console.log('\n⚡ Native Binaries');
  if (output.checks.nativeBinaries.status === 'native') {
    console.log('   ' + colors.green('✅ Native mode (fastest)'));
  } else {
    console.log('   ' + colors.yellow('○ CLI mode (falls back via npx)'));
    if (output.checks.nativeBinaries.reason) {
      console.log('      ' + colors.gray(output.checks.nativeBinaries.reason));
    }
  }
  
  // Config
  console.log('\n⚙️  Config');
  if (output.checks.config.exists) {
    console.log('   ' + colors.green('✅ Config file found'));
    if (output.checks.config.optimizations.length > 0) {
      console.log('      ' + colors.gray('Optimizations: ' + output.checks.config.optimizations.join(', ')));
    }
  } else {
    console.log('   ' + colors.yellow('○ No config file (optional)'));
  }
  
  // Action items
  if (output.actionItems.length > 0) {
    console.log('\n' + colors.gray('─'.repeat(55)));
    console.log('📋 Action Items\n');
    
    for (const item of output.actionItems) {
      const priorityColor = item.priority === 'critical' ? colors.red :
                           item.priority === 'high' ? colors.yellow :
                           item.priority === 'medium' ? colors.blue : colors.gray;
      
      console.log(`  [${priorityColor(item.priority.toUpperCase())}] ${item.action}`);
      console.log(`      ${colors.gray(item.reason)}`);
      if (item.command) {
        console.log(`      ${colors.green(item.command)}`);
      }
      console.log();
    }
  }
  
  // Quick install
  if (output.installCommands.deps || output.installCommands.cliTools) {
    console.log(colors.gray('─'.repeat(55)));
    console.log('\n🚀 Quick Install\n');
    
    if (output.installCommands.deps) {
      console.log('  ' + colors.cyan('Dependencies:'));
      console.log('  ' + colors.green(output.installCommands.deps));
    }
    
    if (output.installCommands.cliTools) {
      console.log('\n  ' + colors.cyan('CLI Tools:'));
      console.log('  ' + colors.green(output.installCommands.cliTools));
    }
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

// Exit with appropriate code
process.exit(output.status === 'ready' ? 0 : 1);
