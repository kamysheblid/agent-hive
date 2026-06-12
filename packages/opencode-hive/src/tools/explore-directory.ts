import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Simple gitignore-style pattern matcher.
 * Supports: *, !, leading /, trailing /
 */
function gitignoreMatch(pattern: string, name: string, isDir: boolean): boolean {
  let pat = pattern.trim();

  // Empty lines or comments
  if (!pat || pat.startsWith('#')) return false;

  // Negation
  let negate = false;
  if (pat.startsWith('!')) {
    negate = true;
    pat = pat.slice(1);
  }

  // Trailing / means directory-only
  let dirOnly = false;
  if (pat.endsWith('/')) {
    dirOnly = true;
    pat = pat.slice(0, -1);
    if (!isDir) return false;
  }

  // Leading / means rooted at current level
  if (pat.startsWith('/')) {
    pat = pat.slice(1);
  }

  // Convert gitignore glob to regex
  // Escape regex special chars, then convert gitignore patterns
  const regexStr = '^' + pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex chars
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/\?/g, '[^/]'); // ? matches single non-slash

  const re = new RegExp(regexStr);
  const matched = re.test(name);

  return negate ? !matched : matched;
}

function loadGitignore(dirPath: string): string[] {
  const gitignorePath = path.join(dirPath, '.gitignore');
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      return content.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
    }
  } catch {
    // Ignore read errors
  }
  return [];
}

function isBinary(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);

    // Check for null bytes in the first 512 bytes
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    // If we can't read, assume non-binary
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export interface ExploreDirectoryArgs {
  path: string;
  depth?: number;
  maxFileSize?: number;
  showContent?: boolean;
}

export interface ExploreDirectoryResult {
  tree: string;
  stats: {
    files: number;
    dirs: number;
    totalSize: number;
  };
  content?: Record<string, string>;
}

interface WalkEntry {
  name: string;
  fullPath: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  symlinkTarget?: string;
  children?: WalkEntry[];
  isBinary?: boolean;
}

function shouldIgnore(name: string, isDir: boolean, gitignorePatterns: string[]): boolean {
  let ignored = false;
  for (const pattern of gitignorePatterns) {
    if (gitignoreMatch(pattern, name, isDir)) {
      ignored = true;
    }
  }
  return ignored;
}

/**
 * Internal recursion: walks directory tree and returns structured entries
 */
function walkDir(
  dirPath: string,
  depth: number,
  currentDepth: number,
  gitignorePatterns: string[],
): WalkEntry[] {
  if (currentDepth > depth) return [];
  const atDepthLimit = currentDepth === depth;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    // Permission denied or other read error — skip gracefully
    return [];
  }

  const results: WalkEntry[] = [];

  // Check for .gitignore at this level and merge with parent patterns
  const localPatterns = loadGitignore(dirPath);
  // Local patterns override parent patterns (if negated etc)
  // Simple approach: combined list, later patterns can override
  const combinedPatterns = [...gitignorePatterns, ...localPatterns];

  for (const entry of entries) {
    const name = entry.name;
    const isDir = entry.isDirectory();
    const isSymlink = entry.isSymbolicLink();

    // Skip hidden files unless explicitly needed
    if (name.startsWith('.') && name !== '.gitignore') continue;

    // Check gitignore
    if (shouldIgnore(name, isDir, combinedPatterns)) continue;

    const fullPath = path.join(dirPath, name);

    if (isSymlink) {
      // Read symlink target without following
      let symlinkTarget: string | undefined;
      try {
        symlinkTarget = fs.readlinkSync(fullPath);
      } catch {
        symlinkTarget = '<unreadable>';
      }
      results.push({
        name,
        fullPath,
        isDir: false,
        isSymlink: true,
        size: 0,
        symlinkTarget,
      });
      continue;
    }

    if (isDir) {
      // At depth limit, don't show subdirectories at all
      if (atDepthLimit) continue;
      const children = walkDir(fullPath, depth, currentDepth + 1, combinedPatterns);
      results.push({
        name,
        fullPath,
        isDir: true,
        isSymlink: false,
        size: 0,
        children,
      });
    } else {
      // Regular file
      let size = 0;
      try {
        const stat = fs.statSync(fullPath);
        size = stat.size;
      } catch {
        // Skip unreadable files
        continue;
      }
      const binary = isBinary(fullPath);
      results.push({
        name,
        fullPath,
        isDir: false,
        isSymlink: false,
        size,
        isBinary: binary,
      });
    }
  }

  return results;
}

/**
 * Render tree from WalkEntry array
 */
function renderTree(
  entries: WalkEntry[],
  prefix: string = '',
  isLast: boolean = true,
): string {
  let output = '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const last = i === entries.length - 1;
    const linePrefix = last ? '└── ' : '├── ';
    const nextPrefix = prefix + (last ? '    ' : '│   ');

    if (entry.isSymlink) {
      const target = entry.symlinkTarget ? ` → ${entry.symlinkTarget}` : '';
      output += `${prefix}${linePrefix}${entry.name} [symlink${target}]\n`;
      continue;
    }

    if (entry.isDir) {
      output += `${prefix}${linePrefix}${entry.name}/\n`;
      if (entry.children && entry.children.length > 0) {
        output += renderTree(entry.children, nextPrefix, last);
      }
    } else {
      const binaryTag = entry.isBinary ? ' [binary]' : '';
      const sizeStr = entry.size > 0 ? ` (${formatBytes(entry.size)})` : '';
      output += `${prefix}${linePrefix}${entry.name}${sizeStr}${binaryTag}\n`;
    }
  }

  return output;
}

/**
 * Count stats in WalkEntry tree
 */
function countStats(
  entries: WalkEntry[],
): { files: number; dirs: number; totalSize: number } {
  let files = 0;
  let dirs = 0;
  let totalSize = 0;

  for (const entry of entries) {
    if (entry.isSymlink) continue; // symlinks not counted
    if (entry.isDir) {
      dirs++;
      if (entry.children) {
        const childStats = countStats(entry.children);
        files += childStats.files;
        dirs += childStats.dirs;
        totalSize += childStats.totalSize;
      }
    } else {
      files++;
      totalSize += entry.size;
    }
  }

  return { files, dirs, totalSize };
}

/**
 * Get root-level file content previews
 */
function getRootContent(
  entries: WalkEntry[],
  rootDir: string,
  maxFileSize: number,
): Record<string, string> {
  const content: Record<string, string> = {};

  for (const entry of entries) {
    if (entry.isSymlink || entry.isDir || entry.isBinary) continue;

    if (entry.size > maxFileSize) {
      try {
        const fd = fs.openSync(entry.fullPath, 'r');
        const buffer = Buffer.alloc(maxFileSize);
        const bytesRead = fs.readSync(fd, buffer, 0, maxFileSize, 0);
        fs.closeSync(fd);
        const relPath = path.relative(rootDir, entry.fullPath);
        content[relPath] = buffer.toString('utf-8', 0, bytesRead) + '\n... [truncated]';
      } catch {
        // Skip unreadable files
      }
      continue;
    }

    if (entry.size > 0) {
      try {
        const data = fs.readFileSync(entry.fullPath, 'utf-8');
        const relPath = path.relative(rootDir, entry.fullPath);
        content[relPath] = data;
      } catch {
        // Skip unreadable
      }
    }
  }

  return content;
}

/**
 * Explore directory tool - main export
 */
export async function exploreDirectory(args: ExploreDirectoryArgs): Promise<ExploreDirectoryResult> {
  const dirPath = args.path;
  let maxDepth = args.depth ?? 3;
  if (maxDepth < 0) maxDepth = 0;
  if (maxDepth > 10) maxDepth = 10;
  const maxFileSize = args.maxFileSize ?? 51200;

  // Validate path
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dirPath);
  } catch (error: any) {
    throw new Error(`Path not accessible: ${dirPath} — ${error.message}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  // Walk directory tree
  const gitignorePatterns = loadGitignore(dirPath);
  const entries = walkDir(dirPath, maxDepth, 0, gitignorePatterns);
  const tree = renderTree(entries);
  const stats = countStats(entries);

  const result: ExploreDirectoryResult = {
    tree: tree.trimEnd(),
    stats,
  };

  // Root-level content preview
  if (args.showContent) {
    const content = getRootContent(entries, dirPath, maxFileSize);
    if (Object.keys(content).length > 0) {
      result.content = content;
    }
  }

  return result;
}


