import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { exploreDirectory } from './explore-directory.js';

export const exploreDirectoryTool: ToolDefinition = tool({
  description: `Explore a directory and return a structured tree overview.
Walks the directory recursively with depth limit, applies .gitignore filtering, detects binary files, and reports symlinks without following them.

**Parameters:**
- path: Directory to explore
- depth: Max recursion depth (default: 3, max: 10)
- maxFileSize: Max file size in bytes for content preview (default: 51200)
- showContent: Include content preview of root files (default: false)

**Returns:**
- tree: Nested tree string with indentation
- stats: { files, dirs, totalSize }
- content: (optional) Root-level file content previews

**Example:**
\`\`\`
explore_directory({ path: "./src", depth: 2, showContent: true })
\`\`\``,
  args: {
    path: tool.schema.string().describe('Directory to explore'),
    depth: tool.schema.number().optional().default(3).describe('Max recursion depth (default: 3, max: 10)'),
    maxFileSize: tool.schema.number().optional().default(51200).describe('Max file size in bytes for content preview (default: 51200)'),
    showContent: tool.schema.boolean().optional().default(false).describe('Include content preview of root files (default: false)'),
  },
  async execute(args) {
    try {
      const result = await exploreDirectory(args);
      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2);
    }
  },
});
