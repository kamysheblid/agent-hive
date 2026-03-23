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
 * 
 * Auto-install dependencies:
 *   bunx @hung319/opencode-hive doctor --install
 *   bunx @hung319/opencode-hive doctor --install /path/to/project
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
// First-run detection
// ============================================================================

function isFirstRun(): boolean {
  const markerPath = path.join(process.env.HOME || '', '.config', 'opencode', '.hive-doctor-run');
  if (fs.existsSync(markerPath)) {
    return false;
  }
  // Create marker
  try {
    const dir = path.dirname(markerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(markerPath, JSON.stringify({ firstRun: new Date().toISOString() }));
  } catch {}
  return true;
}

function printFirstRunMessage() {
  console.log(c.cyan('\n🚀 Welcome to Hive Doctor!'));
  console.log(c.gray('  This is your first run. Let me check your setup...\n'));
}

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
  
  // Check in multiple locations
  const locations = [
    process.cwd(),                    // Current project
    '/root/.local',                   // Common global location
    '/usr/local',                     // Another common global
  ];
  
  for (const prefix of locations) {
    const nodeModulesPath = path.join(prefix, 'node_modules', name);
    if (fs.existsSync(nodeModulesPath)) {
      result.installed = true;
      // Try to get version from package.json
      try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(nodeModulesPath, 'package.json'), 'utf-8'));
        result.version = pkgJson.version;
      } catch {
        result.version = 'installed';
      }
      return result;
    }
  }
  
  // Check if package is installed (local project)
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
  const cmdName = command.split(' ')[0];
  
  // Check if binary exists in common global bin locations
  const binLocations = [
    '/root/.local/bin',
    '/usr/local/bin',
    '/usr/bin',
    path.join(process.cwd(), 'node_modules', '.bin'),
  ];
  
  for (const binDir of binLocations) {
    if (fs.existsSync(path.join(binDir, cmdName))) {
      result.installed = true;
      result.version = 'installed';
      return result;
    }
  }
  
  // Also check if package is installed globally or locally
  try {
    execSync(`npm list -g ${cmdName} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
    result.installed = true;
    result.version = 'via npm';
    return result;
  } catch {}
  
  // Try npx to check if available
  try {
    execSync(`npx -y ${cmdName} --version 2>&1 || true`, { 
      stdio: 'pipe', 
      timeout: 5000 
    });
    result.installed = true;
    result.version = 'via npx';
    return result;
  } catch {}
  
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
// Auto-install dependencies (--install flag)
// ============================================================================

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface InstallResult {
  installed: string[];
  failed: string[];
  skipped: string[];
}

function findPackageJsons(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];
  
  function search(currentDir: string, depth: number) {
    if (depth > maxDepth) return;
    
    const packageJson = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJson)) {
      results.push(packageJson);
    }
    
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          search(path.join(currentDir, entry.name), depth + 1);
        }
      }
    } catch {}
  }
  
  search(dir, 0);
  return results;
}

function getOptionalDeps(packageJson: PackageJson): string[] {
  const optional: string[] = [];
  
  // peerDependenciesMeta marks packages as optional
  if (packageJson.peerDependenciesMeta) {
    for (const [name, meta] of Object.entries(packageJson.peerDependenciesMeta)) {
      if (meta.optional) {
        optional.push(name);
      }
    }
  }
  
  return optional;
}

function checkPackageInstalled(name: string, installPath: string): boolean {
  try {
    // Check in node_modules of the project
    const nodeModulesPath = path.join(installPath, 'node_modules', name);
    if (fs.existsSync(nodeModulesPath)) {
      return true;
    }
    
    // Check globally
    execSync(`npm list ${name} --depth=0 --prefix ${installPath}`, {
      stdio: 'ignore',
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

function installDependencies(projectPath: string, packages: string[]): InstallResult {
  const result: InstallResult = {
    installed: [],
    failed: [],
    skipped: [],
  };
  
  console.log(c.cyan(`\n📦 Scanning ${projectPath} for dependencies...\n`));
  
  for (const pkg of packages) {
    if (checkPackageInstalled(pkg, projectPath)) {
      result.skipped.push(pkg);
      continue;
    }
    
    console.log(c.cyan(`  Installing ${pkg}...`));
    try {
      execSync(`npm install ${pkg} --prefix ${projectPath}`, {
        stdio: 'inherit',
        timeout: 120000,
      });
      result.installed.push(pkg);
      console.log(c.green(`    ✓ ${pkg} installed`));
    } catch {
      // Try with --legacy-peer-deps
      try {
        execSync(`npm install ${pkg} --prefix ${projectPath} --legacy-peer-deps`, {
          stdio: 'inherit',
          timeout: 120000,
        });
        result.installed.push(pkg);
        console.log(c.green(`    ✓ ${pkg} installed (--legacy-peer-deps)`));
      } catch {
        result.failed.push(pkg);
        console.log(c.red(`    ✗ ${pkg} failed`));
      }
    }
  }
  
  return result;
}

function scanAndInstall(targetPath: string): void {
  console.log(c.cyan(`\n🔍 Scanning: ${targetPath}\n`));
  
  if (!fs.existsSync(targetPath)) {
    console.log(c.red(`✗ Path not found: ${targetPath}`));
    return;
  }
  
  // Find all package.json files
  const packageJsons = findPackageJsons(targetPath);
  
  if (packageJsons.length === 0) {
    console.log(c.yellow('⚠ No package.json found'));
    return;
  }
  
  console.log(c.gray(`Found ${packageJsons.length} package.json(s)\n`));
  
  // Collect all optional dependencies from all packages
  const allOptionalDeps = new Set<string>();
  
  for (const pkgJsonPath of packageJsons) {
    const dir = path.dirname(pkgJsonPath);
    const pkgName = path.basename(dir);
    
    try {
      const content = fs.readFileSync(pkgJsonPath, 'utf-8');
      const pkg: PackageJson = JSON.parse(content);
      const optional = getOptionalDeps(pkg);
      
      if (optional.length > 0) {
        console.log(c.gray(`  ${pkgJsonPath}:`));
        console.log(c.gray(`    Optional deps: ${optional.join(', ')}`));
        optional.forEach(dep => allOptionalDeps.add(dep));
      }
    } catch {
      console.log(c.red(`  ✗ Failed to read: ${pkgJsonPath}`));
    }
  }
  
  if (allOptionalDeps.size === 0) {
    console.log(c.yellow('\n⚠ No optional dependencies found'));
    return;
  }
  
  // Install to the root project (first package.json found)
  const rootProject = path.dirname(packageJsons[0]);
  console.log(c.cyan(`\n📦 Installing to: ${rootProject}\n`));
  
  const result = installDependencies(rootProject, Array.from(allOptionalDeps));
  
  // Summary
  console.log('\n' + c.blue('═'.repeat(50)));
  console.log(c.green(`✓ Installed: ${result.installed.length}`));
  if (result.skipped.length > 0) {
    console.log(c.gray(`○ Skipped (already installed): ${result.skipped.length}`));
  }
  if (result.failed.length > 0) {
    console.log(c.red(`✗ Failed: ${result.failed.length}`));
  }
  console.log(c.blue('═'.repeat(50)));
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
    version: '1.10.8',
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
  
  // Check CLI tools and MCPs
  const cliToolsList = [
    { name: 'dora', command: '@butttons/dora', desc: 'SCIP-based code navigation' },
    { name: 'auto-cr', command: 'auto-cr-cmd', desc: 'SWC-based code review' },
    { name: 'btca', command: 'btca', desc: 'BTC/A blockchain agent' },
    // MCPs
    { name: 'ddg_search', command: '@oevortex/ddg_search', desc: 'DuckDuckGo search (free)' },
    { name: 'searxng', command: 'mcp-searxng', desc: 'SearXNG meta-search (privacy)' },
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
  console.log(c.gray('  bunx @hung319/opencode-hive doctor --install'));
  console.log(c.gray('  bunx @hung319/opencode-hive doctor --install /path/to/project'));
  console.log(c.blue('═'.repeat(55)) + '\n');
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
const autoFix = args.includes('--fix') || args.includes('-f');
const ciMode = process.env.CI === 'true' || args.includes('--ci');
const installMode = args.includes('--install') || args.includes('-i');

// Get target path from args (for --install)
// Look for path after --install or -i flag
let targetPath = process.cwd();
const installIndex = args.findIndex(arg => arg === '--install' || arg === '-i');
if (installIndex !== -1 && installIndex + 1 < args.length) {
  const nextArg = args[installIndex + 1];
  if (!nextArg.startsWith('--')) {
    targetPath = path.resolve(nextArg);
  }
}

// Handle --install mode - run doctor first to get what's missing, then install
if (installMode) {
  // targetPath is the install prefix (e.g., /root/.local for global installs)
  console.log(c.cyan(`\n🔧 Auto-installing to: ${targetPath}\n`));

  // Run doctor to see what's missing
  const output = runDoctor(false);
  
  // Auto-install missing tools
  const missingCli = output.checks.cliTools.items.filter(t => !t.installed);
  const missingAgent = output.checks.agentTools.items.filter(t => !t.installed);
  
  // Install CLI tools via npm (not running CLI which may hang)
  for (const tool of missingCli) {
    try {
      console.log(c.cyan(`  Installing CLI ${tool.name}...`));
      // Install package, not run CLI (which may hang for MCP servers)
      execSync(`npm install -g ${tool.command}`, {
        stdio: 'inherit',
        timeout: 120000,
      });
      console.log(c.green(`    ✓ ${tool.name} ready`));
    } catch {
      console.log(c.red(`    ✗ ${tool.name} failed`));
    }
  }
  
  // Install agent tools to targetPath (like global npm install)
  for (const tool of missingAgent) {
    try {
      console.log(c.cyan(`  Installing ${tool.name} to ${targetPath}...`));
      // Use npm install with prefix to install to that location
      execSync(`npm install ${tool.name} --prefix ${targetPath}`, {
        stdio: 'inherit',
        timeout: 180000,
      });
      console.log(c.green(`    ✓ ${tool.name} installed`));
    } catch {
      console.log(c.red(`    ✗ ${tool.name} failed`));
    }
  }
  
  // Add to shell config if needed
  const pathEntry = 'export PATH="/root/.local/bin:$PATH"';
  const shellConfigs = [
    { path: path.join(process.env.HOME || '', '.bashrc'), shebang: '# bash' },
    { path: path.join(process.env.HOME || '', '.bash_profile'), shebang: '# bash' },
    { path: path.join(process.env.HOME || '', '.zshrc'), shebang: '# zsh' },
  ];
  
  let pathAdded = false;
  for (const config of shellConfigs) {
    if (!fs.existsSync(config.path)) continue;
    
    try {
      const content = fs.readFileSync(config.path, 'utf-8');
      if (!content.includes('/root/.local/bin')) {
        fs.appendFileSync(config.path, `\n# Added by Hive Doctor\n${pathEntry}\n`);
        pathAdded = true;
        console.log(c.green(`    ✓ Added PATH to ${config.path}`));
      }
    } catch {}
  }
  
  if (pathAdded) {
    console.log(c.yellow('\n💡 Run this to use new tools in current session:'));
    console.log(c.gray(`  source ~/.bashrc  # or ~/.zshrc`));
  }
  
  // Show summary
  console.log('\n' + c.blue('═'.repeat(50)));
  console.log(c.green('✓ Auto-install complete'));
  console.log(c.blue('═'.repeat(50)));
  
  // Run doctor again to verify
  console.log(c.cyan('\n🔍 Verifying installation...\n'));
  const verifyOutput = runDoctor(false);
  printDoctor(verifyOutput);
  
  process.exit(0);
}

// Show first-run message if applicable
if (isFirstRun()) {
  printFirstRunMessage();
}

const output = runDoctor(autoFix);
printDoctor(output);

// In CI mode, only fail on critical errors, not on missing optional tools
if (ciMode) {
  process.exit(0);
}

process.exit(output.status === 'ready' ? 0 : 1);
