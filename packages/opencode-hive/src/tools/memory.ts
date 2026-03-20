import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Hive Memory System
 * 
 * Persistent memory blocks similar to Letta's memory blocks.
 * - global: Shared across all projects (stored in ~/.config/opencode/hive/memory/)
 * - project: Project-scoped memory (stored in .hive/memory/)
 */

// ============================================================================
// Types
// ============================================================================

export interface MemoryBlock {
  scope: 'global' | 'project';
  label: string;
  description: string;
  limit: number;
  readOnly: boolean;
  value: string;
  filePath: string;
  lastModified: string;
  charsCurrent: number;
}

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  project?: string;
  tags: string[];
  created: string;
  filePath: string;
}

// ============================================================================
// Paths
// ============================================================================

function getGlobalMemoryDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'hive', 'memory', 'global');
}

function getProjectMemoryDir(projectRoot: string): string {
  return path.join(projectRoot, '.hive', 'memory', 'project');
}

function getJournalDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'hive', 'journal');
}

// ============================================================================
// Memory File Operations
// ============================================================================

function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  if (!content.startsWith('---\n')) {
    return { frontmatter: {}, body: content };
  }
  
  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }
  
  const fmText = content.slice(4, endIndex);
  const body = content.slice(endIndex + 5);
  
  // Simple YAML parsing
  const frontmatter: Record<string, any> = {};
  for (const line of fmText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value === 'true') frontmatter[key] = true;
      else if (value === 'false') frontmatter[key] = false;
      else if (!isNaN(Number(value))) frontmatter[key] = Number(value);
      else frontmatter[key] = value;
    }
  }
  
  return { frontmatter, body };
}

function buildFrontmatter(frontmatter: Record<string, any>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.length > 0 ? `---\n${lines.join('\n')}\n---\n` : '';
}

function readMemoryBlock(filePath: string, scope: 'global' | 'project'): MemoryBlock {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);
  
  const label = frontmatter.label || path.basename(filePath, path.extname(filePath));
  const description = frontmatter.description || 'Memory block';
  const limit = frontmatter.limit || 5000;
  const readOnly = frontmatter.read_only === true;
  const stats = fs.statSync(filePath);
  
  return {
    scope,
    label,
    description,
    limit,
    readOnly,
    value: body.trim(),
    filePath,
    lastModified: stats.mtime.toISOString(),
    charsCurrent: body.trim().length,
  };
}

function listMemoryBlocks(scope: 'global' | 'project', projectRoot: string): MemoryBlock[] {
  const dir = scope === 'global' ? getGlobalMemoryDir() : getProjectMemoryDir(projectRoot);
  
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const blocks: MemoryBlock[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.md')) {
      const filePath = path.join(dir, file);
      try {
        blocks.push(readMemoryBlock(filePath, scope));
      } catch {
        // Skip invalid files
      }
    }
  }
  
  return blocks.sort((a, b) => {
    // Priority order: persona > human > project > others
    const priority: Record<string, number> = { persona: 0, human: 1, project: 2 };
    const pa = priority[a.label] ?? 10;
    const pb = priority[b.label] ?? 10;
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });
}

// ============================================================================
// Memory Seeding
// ============================================================================

const SEED_BLOCKS = [
  { scope: 'global' as const, label: 'persona', description: 'How the agent should behave and respond. Personality, communication style, constraints.' },
  { scope: 'global' as const, label: 'human', description: 'Key details about the user: preferences, habits, constraints, working style.' },
  { scope: 'project' as const, label: 'project', description: 'Project-specific knowledge: commands, architecture, conventions, gotchas.' },
];

export async function ensureMemorySeeded(projectRoot: string): Promise<void> {
  for (const seed of SEED_BLOCKS) {
    const dir = seed.scope === 'global' ? getGlobalMemoryDir() : getProjectMemoryDir(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, `${seed.label}.md`);
    if (!fs.existsSync(filePath)) {
      const content = buildFrontmatter({
        label: seed.label,
        description: seed.description,
        limit: 5000,
        read_only: false,
      });
      fs.writeFileSync(filePath, content + '\n', 'utf-8');
    }
  }
}

// ============================================================================
// Journal Operations
// ============================================================================

function writeJournalEntry(title: string, body: string, project?: string, tags: string[] = []): JournalEntry {
  const journalDir = getJournalDir();
  fs.mkdirSync(journalDir, { recursive: true });
  
  const now = new Date();
  const id = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}-${String(now.getUTCMilliseconds()).padStart(3, '0')}`;
  
  const filePath = path.join(journalDir, `${id}.md`);
  const frontmatter = buildFrontmatter({
    title,
    project: project || '',
    tags,
    created: now.toISOString(),
  });
  
  fs.writeFileSync(filePath, frontmatter + body + '\n', 'utf-8');
  
  return {
    id,
    title,
    body,
    project,
    tags,
    created: now.toISOString(),
    filePath,
  };
}

function searchJournalEntries(query?: string, project?: string, limit = 20): { entries: JournalEntry[]; total: number } {
  const journalDir = getJournalDir();
  
  if (!fs.existsSync(journalDir)) {
    return { entries: [], total: 0 };
  }
  
  const entries: JournalEntry[] = [];
  const files = fs.readdirSync(journalDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
  
  for (const file of files) {
    const filePath = path.join(journalDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);
    
    const entry: JournalEntry = {
      id: file.replace('.md', ''),
      title: frontmatter.title || 'Untitled',
      body: body.trim(),
      project: frontmatter.project,
      tags: frontmatter.tags || [],
      created: frontmatter.created || '',
      filePath,
    };
    
    // Filter by project
    if (project && entry.project !== project) continue;
    
    // Filter by text query
    if (query) {
      const searchText = `${entry.title} ${entry.body}`.toLowerCase();
      if (!searchText.includes(query.toLowerCase())) continue;
    }
    
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  
  return { entries, total: files.length };
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const hiveMemoryListTool: ToolDefinition = tool({
  description: 'List all memory blocks. Shows global (cross-project) and project-scoped blocks with descriptions and sizes.',
  args: {
    scope: tool.schema.enum(['global', 'project', 'all']).optional().describe('Scope to list: global, project, or all (default: all)'),
  },
  async execute({ scope = 'all' }) {
    const projectRoot = process.cwd();
    
    const blocks: MemoryBlock[] = [];
    
    if (scope === 'global' || scope === 'all') {
      blocks.push(...listMemoryBlocks('global', projectRoot));
    }
    if (scope === 'project' || scope === 'all') {
      blocks.push(...listMemoryBlocks('project', projectRoot));
    }
    
    if (blocks.length === 0) {
      return JSON.stringify({
        message: 'No memory blocks found. Use hive_memory_set to create one.',
        global: [],
        project: [],
      }, null, 2);
    }
    
    const grouped = {
      global: blocks.filter(b => b.scope === 'global'),
      project: blocks.filter(b => b.scope === 'project'),
    };
    
    return JSON.stringify({
      total: blocks.length,
      global: grouped.global.map(b => ({
        label: b.label,
        description: b.description,
        charsCurrent: b.charsCurrent,
        charsLimit: b.limit,
        readOnly: b.readOnly,
        lastModified: b.lastModified,
      })),
      project: grouped.project.map(b => ({
        label: b.label,
        description: b.description,
        charsCurrent: b.charsCurrent,
        charsLimit: b.limit,
        readOnly: b.readOnly,
        lastModified: b.lastModified,
      })),
    }, null, 2);
  },
});

export const hiveMemorySetTool: ToolDefinition = tool({
  description: 'Create or overwrite a memory block. Use for full updates.',
  args: {
    scope: tool.schema.enum(['global', 'project']).describe('Scope: global (cross-project) or project (project-scoped)'),
    label: tool.schema.string().describe('Label for the memory block (e.g., persona, human, project, conventions)'),
    value: tool.schema.string().describe('Content to store in the memory block'),
    description: tool.schema.string().optional().describe('Description of how this block should be used'),
    limit: tool.schema.number().optional().describe('Maximum characters allowed (default: 5000)'),
    readOnly: tool.schema.boolean().optional().describe('Make block read-only (default: false)'),
  },
  async execute({ scope, label, value, description, limit = 5000, readOnly = false }) {
    const projectRoot = process.cwd();
    
    // Validate label
    if (!/^[a-z0-9][a-z0-9-_]{1,60}$/i.test(label)) {
      return JSON.stringify({
        success: false,
        error: `Invalid label "${label}". Use letters/numbers/dash/underscore (2-61 chars).`,
      }, null, 2);
    }
    
    // Check size limit
    if (value.length > limit) {
      return JSON.stringify({
        success: false,
        error: `Value too large (${value.length} chars, limit: ${limit})`,
        hint: 'Use hive_memory_replace for surgical edits, or increase the limit.',
      }, null, 2);
    }
    
    const dir = scope === 'global' ? getGlobalMemoryDir() : getProjectMemoryDir(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, `${label}.md`);
    
    // Check if existing block is read-only
    if (fs.existsSync(filePath)) {
      const existing = readMemoryBlock(filePath, scope);
      if (existing.readOnly) {
        return JSON.stringify({
          success: false,
          error: `Memory block "${scope}:${label}" is read-only`,
        }, null, 2);
      }
    }
    
    const content = buildFrontmatter({
      label,
      description: description || `Memory block: ${label}`,
      limit,
      read_only: readOnly,
    });
    
    fs.writeFileSync(filePath, content + value + '\n', 'utf-8');
    
    return JSON.stringify({
      success: true,
      scope,
      label,
      charsWritten: value.length,
      charsLimit: limit,
    }, null, 2);
  },
});

export const hiveMemoryReplaceTool: ToolDefinition = tool({
  description: 'Replace a substring within a memory block. Use for surgical edits.',
  args: {
    scope: tool.schema.enum(['global', 'project']).describe('Scope of the memory block'),
    label: tool.schema.string().describe('Label of the memory block'),
    oldText: tool.schema.string().describe('Text to find and replace'),
    newText: tool.schema.string().describe('Replacement text'),
  },
  async execute({ scope, label, oldText, newText }) {
    const projectRoot = process.cwd();
    
    const dir = scope === 'global' ? getGlobalMemoryDir() : getProjectMemoryDir(projectRoot);
    const filePath = path.join(dir, `${label}.md`);
    
    if (!fs.existsSync(filePath)) {
      return JSON.stringify({
        success: false,
        error: `Memory block not found: ${scope}:${label}`,
      }, null, 2);
    }
    
    const block = readMemoryBlock(filePath, scope);
    
    if (block.readOnly) {
      return JSON.stringify({
        success: false,
        error: `Memory block "${scope}:${label}" is read-only`,
      }, null, 2);
    }
    
    if (!block.value.includes(oldText)) {
      return JSON.stringify({
        success: false,
        error: `Text not found in "${scope}:${label}"`,
        hint: 'The oldText must match exactly. Try copying from hive_memory_list output.',
      }, null, 2);
    }
    
    const newValue = block.value.replace(oldText, newText);
    
    if (newValue.length > block.limit) {
      return JSON.stringify({
        success: false,
        error: `Replacement would exceed limit (${newValue.length} > ${block.limit})`,
      }, null, 2);
    }
    
    const content = buildFrontmatter({
      label: block.label,
      description: block.description,
      limit: block.limit,
      read_only: block.readOnly,
    });
    
    fs.writeFileSync(filePath, content + newValue + '\n', 'utf-8');
    
    return JSON.stringify({
      success: true,
      scope,
      label,
      charsReplaced: newValue.length,
    }, null, 2);
  },
});

export const hiveJournalWriteTool: ToolDefinition = tool({
  description: 'Write a journal entry. Journal is append-only for capturing insights, decisions, and discoveries.',
  args: {
    title: tool.schema.string().describe('Title of the journal entry'),
    body: tool.schema.string().describe('Content of the journal entry'),
    tags: tool.schema.array(tool.schema.string()).optional().describe('Tags to categorize the entry'),
  },
  async execute({ title, body, tags = [] }) {
    const projectRoot = process.cwd();
    
    const entry = writeJournalEntry(title, body, projectRoot, tags);
    
    return JSON.stringify({
      success: true,
      id: entry.id,
      title: entry.title,
      created: entry.created,
      message: 'Journal entry written successfully',
    }, null, 2);
  },
});

export const hiveJournalSearchTool: ToolDefinition = tool({
  description: 'Search journal entries. Filter by text query, project, or tags.',
  args: {
    query: tool.schema.string().optional().describe('Text to search for in title and body'),
    project: tool.schema.string().optional().describe('Filter by project path'),
    tags: tool.schema.array(tool.schema.string()).optional().describe('Filter by tags'),
    limit: tool.schema.number().optional().describe('Maximum entries to return (default: 20)'),
  },
  async execute({ query, project, tags, limit = 20 }) {
    const result = searchJournalEntries(query, project, limit);
    
    return JSON.stringify({
      total: result.total,
      returned: result.entries.length,
      entries: result.entries.map(e => ({
        id: e.id,
        title: e.title,
        project: e.project,
        tags: e.tags,
        created: e.created,
        preview: e.body.slice(0, 200) + (e.body.length > 200 ? '...' : ''),
      })),
    }, null, 2);
  },
});

// ============================================================================
// System Prompt Injection
// ============================================================================

export async function buildMemoryInjection(projectRoot: string): Promise<string> {
  await ensureMemorySeeded(projectRoot);
  
  const globalBlocks = listMemoryBlocks('global', projectRoot);
  const projectBlocks = listMemoryBlocks('project', projectRoot);
  
  if (globalBlocks.length === 0 && projectBlocks.length === 0) {
    return '';
  }
  
  const sections: string[] = [];
  
  sections.push('<memory_instructions>');
  sections.push('You have access to persistent memory blocks that survive across sessions.');
  sections.push('Use memory tools to store important information, decisions, and preferences.\n');
  
  if (globalBlocks.length > 0) {
    sections.push('## Global Memory (cross-project)');
    for (const block of globalBlocks) {
      sections.push(`\n### ${block.label} (${block.charsCurrent}/${block.limit} chars)`);
      sections.push(`_${block.description}_`);
      sections.push(block.value || '(empty)');
    }
  }
  
  if (projectBlocks.length > 0) {
    sections.push('\n## Project Memory');
    for (const block of projectBlocks) {
      sections.push(`\n### ${block.label} (${block.charsCurrent}/${block.limit} chars)`);
      sections.push(`_${block.description}_`);
      sections.push(block.value || '(empty)');
    }
  }
  
  sections.push('\n</memory_instructions>');
  
  return sections.join('\n');
}

// ============================================================================
// Enhanced Memory (from simple-memory plugin)
// Typed memories with scope, type, and search
// ============================================================================

export type MemoryType = 'decision' | 'learning' | 'preference' | 'blocker' | 'context' | 'pattern';

export interface TypedMemory {
  ts: string;
  type: MemoryType;
  scope: string;
  content: string;
  issue?: string;
  tags?: string[];
}

interface TypedMemoryFile {
  filepath: string;
  lineIndex: number;
}

function getTypedMemoryDir(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'hive', 'typed-memory');
}

function getTypedMemoryFile(): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(getTypedMemoryDir(), `${date}.logfmt`);
}

function getDeletionsFile(): string {
  return path.join(getTypedMemoryDir(), 'deletions.logfmt');
}

function parseTypedMemoryLine(line: string): TypedMemory | null {
  const tsMatch = line.match(/ts=([^\s]+)/);
  const typeMatch = line.match(/type=([^\s]+)/);
  const scopeMatch = line.match(/scope=([^\s]+)/);
  const contentMatch = line.match(/content="([^"]*(?:\\"[^"]*)*)"/);
  const issueMatch = line.match(/issue=([^\s]+)/);
  const tagsMatch = line.match(/tags=([^\s]+)/);

  if (!tsMatch?.[1] || !typeMatch?.[1] || !scopeMatch?.[1]) return null;

  return {
    ts: tsMatch[1],
    type: typeMatch[1] as MemoryType,
    scope: scopeMatch[1],
    content: contentMatch?.[1]?.replace(/\\"/g, '"') || '',
    issue: issueMatch?.[1],
    tags: tagsMatch?.[1]?.split(','),
  };
}

function formatTypedMemory(m: TypedMemory): string {
  const date = m.ts.split('T')[0];
  const tags = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
  const issue = m.issue ? ` (${m.issue})` : '';
  return `[${date}] ${m.type}/${m.scope}: ${m.content}${issue}${tags}`;
}

function scoreTypedMemoryMatch(memory: TypedMemory, words: string[]): number {
  const searchable = `${memory.type} ${memory.scope} ${memory.content} ${memory.tags?.join(' ') || ''}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (searchable.includes(word)) score++;
    if (memory.scope.toLowerCase() === word) score += 2;
    if (memory.type.toLowerCase() === word) score += 2;
  }
  return score;
}

async function ensureTypedMemoryDir(): Promise<void> {
  const dir = getTypedMemoryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function getAllTypedMemories(): Promise<TypedMemory[]> {
  const dir = getTypedMemoryDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.logfmt'));
  if (!files.length) return [];

  const lines: string[] = [];
  for (const filename of files) {
    if (filename === 'deletions.logfmt') continue;
    const filepath = path.join(dir, filename);
    const text = fs.readFileSync(filepath, 'utf-8');
    lines.push(...text.trim().split('\n').filter(Boolean));
  }

  return lines.map(parseTypedMemoryLine).filter((m): m is TypedMemory => m !== null);
}

async function findTypedMemories(
  scope?: string,
  type?: MemoryType,
  query?: string
): Promise<TypedMemoryFile[]> {
  const dir = getTypedMemoryDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.logfmt'));
  const matches: TypedMemoryFile[] = [];

  for (const filename of files) {
    if (filename === 'deletions.logfmt') continue;
    const filepath = path.join(dir, filename);
    const text = fs.readFileSync(filepath, 'utf-8');
    const lines = text.split('\n');

    lines.forEach((line, lineIndex) => {
      const memory = parseTypedMemoryLine(line);
      if (!memory) return;
      if (scope && memory.scope !== scope) return;
      if (type && memory.type !== type) return;
      if (query) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (scoreTypedMemoryMatch(memory, words) === 0) return;
      }
      matches.push({ filepath, lineIndex });
    });
  }

  return matches;
}

async function logTypedMemoryDeletion(memory: TypedMemory, reason: string): Promise<void> {
  await ensureTypedMemoryDir();
  const ts = new Date().toISOString();
  const content = memory.content.replace(/"/g, '\\"');
  const escapedReason = reason.replace(/"/g, '\\"');
  const issue = memory.issue ? ` issue=${memory.issue}` : '';
  const tags = memory.tags?.length ? ` tags=${memory.tags.join(',')}` : '';
  const line = `ts=${ts} action=deleted original_ts=${memory.ts} type=${memory.type} scope=${memory.scope} content="${content}" reason="${escapedReason}"${issue}${tags}\n`;

  const file = getDeletionsFile();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  fs.writeFileSync(file, existing + line);
}

// Enhanced Memory Tools

export const hiveMemoryRecallTool: ToolDefinition = tool({
  description: 'Search typed memories by scope, type, or query. Retrieve learnings, decisions, preferences, and patterns.',
  args: {
    scope: tool.schema.string().optional().describe('Filter by scope (e.g., project, user, auth, api)'),
    type: tool.schema.enum(['decision', 'learning', 'preference', 'blocker', 'context', 'pattern']).optional().describe('Filter by memory type'),
    query: tool.schema.string().optional().describe('Search terms (matches type, scope, content)'),
    limit: tool.schema.number().optional().describe('Maximum results (default: 20)'),
  },
  async execute({ scope, type, query, limit = 20 }) {
    await ensureTypedMemoryDir();
    const allMemories = await getAllTypedMemories();

    if (!allMemories.length) {
      return JSON.stringify({
        message: 'No typed memories found. Use hive_memory_set to create one.',
        total: 0,
        results: [],
      }, null, 2);
    }

    let results = allMemories;

    if (scope) {
      results = results.filter(m => m.scope === scope || m.scope.includes(scope));
    }
    if (type) {
      results = results.filter(m => m.type === type);
    }

    if (query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = results
        .map(m => ({ memory: m, score: scoreTypedMemoryMatch(m, words) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);
      results = scored.map(x => x.memory);
    }

    const totalCount = allMemories.length;
    const filteredCount = results.length;
    const limited = results.slice(0, limit);

    if (!limited.length) {
      return JSON.stringify({
        message: 'No matching memories found.',
        total: totalCount,
        results: [],
      }, null, 2);
    }

    return JSON.stringify({
      total: totalCount,
      filtered: filteredCount,
      returned: limited.length,
      results: limited.map(m => ({
        type: m.type,
        scope: m.scope,
        content: m.content,
        created: m.ts,
        issue: m.issue,
        tags: m.tags,
        formatted: formatTypedMemory(m),
      })),
    }, null, 2);
  },
});

export const hiveMemoryUpdateTool: ToolDefinition = tool({
  description: 'Update a typed memory entry. Finds by scope and type, updates content.',
  args: {
    scope: tool.schema.string().describe('Scope of memory to update'),
    type: tool.schema.enum(['decision', 'learning', 'preference', 'blocker', 'context', 'pattern']).describe('Type of memory'),
    content: tool.schema.string().describe('New content'),
    query: tool.schema.string().optional().describe('If multiple matches, filter by query'),
  },
  async execute({ scope, type, content, query }) {
    const matches = await findTypedMemories(scope, type);

    if (matches.length === 0) {
      return JSON.stringify({
        success: false,
        error: `No memories found for ${type} in ${scope}`,
      }, null, 2);
    }

    let target = matches[0];
    if (matches.length > 1 && query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = matches.map(m => {
        const memory = parseTypedMemoryLine(fs.readFileSync(m.filepath, 'utf-8').split('\n')[m.lineIndex]);
        return { match: m, score: memory ? scoreTypedMemoryMatch(memory, words) : 0 };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

      if (scored.length === 0) {
        return JSON.stringify({
          success: false,
          error: `Found ${matches.length} memories for ${type}/${scope}, but none matched query "${query}"`,
        }, null, 2);
      }
      target = scored[0].match;
    }

    // Log old version
    const oldLine = fs.readFileSync(target.filepath, 'utf-8').split('\n')[target.lineIndex];
    const oldMemory = parseTypedMemoryLine(oldLine);
    if (oldMemory) {
      await logTypedMemoryDeletion(oldMemory, `Updated to: ${content}`);
    }

    // Update the memory
    const ts = new Date().toISOString();
    const lines = fs.readFileSync(target.filepath, 'utf-8').split('\n');
    lines[target.lineIndex] = `ts=${ts} type=${type} scope=${scope} content="${content.replace(/"/g, '\\"')}"`;
    fs.writeFileSync(target.filepath, lines.join('\n'));

    return JSON.stringify({
      success: true,
      scope,
      type,
      content,
      message: `Updated ${type} in ${scope}`,
    }, null, 2);
  },
});

export const hiveMemoryForgetTool: ToolDefinition = tool({
  description: 'Delete a typed memory. Logs deletion for audit purposes.',
  args: {
    scope: tool.schema.string().describe('Scope of memory to delete'),
    type: tool.schema.enum(['decision', 'learning', 'preference', 'blocker', 'context', 'pattern']).describe('Type of memory'),
    reason: tool.schema.string().describe('Why this memory is being deleted'),
  },
  async execute({ scope, type, reason }) {
    const matches = await findTypedMemories(scope, type);

    if (matches.length === 0) {
      return JSON.stringify({
        success: false,
        error: `No memories found for ${type} in ${scope}`,
      }, null, 2);
    }

    let deleted = 0;
    const deletedMemories: TypedMemory[] = [];

    for (const match of matches) {
      const text = fs.readFileSync(match.filepath, 'utf-8');
      const lines = text.split('\n');
      const memory = parseTypedMemoryLine(lines[match.lineIndex]);

      if (memory) {
        await logTypedMemoryDeletion(memory, reason);
        deletedMemories.push(memory);
        deleted++;
      }

      lines.splice(match.lineIndex, 1);
      fs.writeFileSync(match.filepath, lines.join('\n'));
    }

    return JSON.stringify({
      success: true,
      deleted,
      scope,
      type,
      reason,
      message: `Deleted ${deleted} ${type} memory(ies) from ${scope}. Deletion logged.`,
    }, null, 2);
  },
});
