import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const testDir = '/tmp/hive-explore-dir-test';

function setupTestDir(structure: Record<string, string | null>) {
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(testDir, filePath);
    if (content === null) {
      // Directory
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }
}

describe('explore_directory', () => {
  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('happy path: directory tree with files and subdirectories', async () => {
    setupTestDir({
      'root.txt': 'hello',
      'subdir/': null,
      'subdir/nested.txt': 'nested content',
      'subdir/deep/': null,
      'subdir/deep/deep.txt': 'deep content',
    });

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 10,
    });

    expect(result.stats.files).toBe(3);
    expect(result.stats.dirs).toBe(2); // subdir and deep
    expect(result.tree).toContain('root.txt');
    expect(result.tree).toContain('subdir');
    expect(result.tree).toContain('nested.txt');
    expect(result.tree).toContain('deep.txt');
  });

  test('empty directory should work with 0 files', async () => {
    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
    });

    expect(result.stats.files).toBe(0);
    expect(result.stats.dirs).toBe(0);
    expect(result.tree).toBe('');
  });

  test('error case: invalid path', async () => {
    const { exploreDirectory } = await import('./explore-directory.js');
    
    expect(
      exploreDirectory({ path: '/nonexistent/path/12345' })
    ).rejects.toThrow();
  });

  test('error case: file path instead of directory', async () => {
    const filePath = path.join(testDir, 'afile.txt');
    fs.writeFileSync(filePath, 'content', 'utf-8');

    const { exploreDirectory } = await import('./explore-directory.js');
    
    expect(
      exploreDirectory({ path: filePath })
    ).rejects.toThrow();
  });

  test('depth limit should stop at specified depth', async () => {
    setupTestDir({
      'l1.txt': 'level 1',
      'd1/': null,
      'd1/l2.txt': 'level 2',
      'd1/d2/': null,
      'd1/d2/l3.txt': 'level 3',
    });

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 1,
    });

    expect(result.stats.files).toBe(2); // root l1.txt + l2.txt inside d1
    expect(result.stats.dirs).toBe(1); // d1 only (d2 is beyond depth limit)
    expect(result.tree).toContain('l1.txt');
    expect(result.tree).toContain('d1');
    expect(result.tree).toContain('l2.txt');
    expect(result.tree).not.toContain('l3.txt');
    expect(result.tree).not.toContain('d2');
  });

  test('.gitignore filtering: files in gitignore should be excluded', async () => {
    setupTestDir({
      'src/': null,
      'src/index.ts': 'export const x = 1;',
      'dist/': null,
      'dist/bundle.js': '// bundle',
      '.gitignore': 'dist/\n',
    });

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
    });

    expect(result.stats.files).toBe(2); // src/index.ts + .gitignore
    expect(result.tree).toContain('src');
    expect(result.tree).toContain('index.ts');
    expect(result.tree).not.toContain('bundle.js');
    expect(result.tree).not.toContain('dist');
  });

  test('.gitignore with wildcard patterns', async () => {
    setupTestDir({
      'main.ts': 'export const main = 1;',
      'main.js': 'var main = 1;',
      'util.ts': 'export const util = 1;',
      'util.js': 'var util = 1;',
      '.gitignore': '*.js\n',
    });

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
    });

    expect(result.stats.files).toBe(3); // main.ts + util.ts + .gitignore
    expect(result.tree).toContain('main.ts');
    expect(result.tree).toContain('util.ts');
    expect(result.tree).not.toContain('main.js');
    expect(result.tree).not.toContain('util.js');
  });

  test('symlink handling: symlinks should show target, not be followed', async () => {
    setupTestDir({
      'real_file.txt': 'real content',
      'realdir/': null,
      'realdir/inside.txt': 'inside',
    });
    // Create symlink to file
    fs.symlinkSync(path.join(testDir, 'real_file.txt'), path.join(testDir, 'link_to_file.txt'));
    // Create symlink to dir
    fs.symlinkSync(path.join(testDir, 'realdir'), path.join(testDir, 'link_to_dir'));

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
    });

    expect(result.stats.files).toBe(2); // real_file.txt + realdir/inside.txt
    expect(result.stats.dirs).toBe(1); // realdir only
    expect(result.tree).toContain('real_file.txt');
    expect(result.tree).toContain('link_to_file.txt [symlink →');
    expect(result.tree).toContain('link_to_dir [symlink →');
    // Should NOT have followed the dir symlink into realdir
    // link_to_dir should show as symlink, and we should see realdir itself (real dir)
    expect(result.tree).toContain('realdir'); // realdir itself is real, should be visited
    expect(result.tree).toContain('inside.txt'); // inside realdir should be seen
  });

  test('binary detection: binary files should be detected', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'text.txt'), 'hello world', 'utf-8');
    // Write binary content (null bytes)
    const binaryContent = Buffer.alloc(100);
    binaryContent[0] = 0x89; // PNG header
    binaryContent[1] = 0x50;
    binaryContent[10] = 0x00; // null byte
    fs.writeFileSync(path.join(testDir, 'binary.bin'), binaryContent);

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
    });

    expect(result.stats.files).toBe(2);
    expect(result.tree).toContain('text.txt');
    expect(result.tree).toContain('binary.bin');
    expect(result.tree).toContain('[binary]');
  });

  test('showContent and maxFileSize: files larger than limit should be truncated', async () => {
    // Create a small file
    fs.writeFileSync(path.join(testDir, 'small.txt'), 'small content', 'utf-8');
    // Create a larger file (bigger than 50 bytes)
    const largeContent = 'A'.repeat(200);
    fs.writeFileSync(path.join(testDir, 'large.txt'), largeContent, 'utf-8');

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
      showContent: true,
      maxFileSize: 50,
    });

    expect(result.content).toBeDefined();
    expect(result.content!['small.txt']).toBe('small content');
    // Content is truncated to maxFileSize bytes, with a truncation suffix appended
    expect(result.content!['large.txt']).toContain('[truncated]');
    expect(result.content!['large.txt']).toContain('...');
    // The original content portion should be <= maxFileSize
    const originalPart = result.content!['large.txt'].split('...')[0] || '';
    expect(originalPart.length).toBeLessThanOrEqual(55); // 50 bytes + newline
  });

  test('showContent: content of root-level files only', async () => {
    setupTestDir({
      'root.txt': 'root content',
      'sub/': null,
      'sub/nested.txt': 'nested content',
    });

    const { exploreDirectory } = await import('./explore-directory.js');
    const result = await exploreDirectory({
      path: testDir,
      depth: 3,
      showContent: true,
    });

    expect(result.content).toBeDefined();
    expect(result.content!['root.txt']).toBe('root content');
    // Nested files should not be in content preview
    expect(result.content!['sub/nested.txt']).toBeUndefined();
  });
});
