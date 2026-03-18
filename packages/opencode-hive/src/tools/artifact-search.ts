import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin";

/**
 * artifact_search tool
 * 
 * Requires: SQLite artifact-index database
 * 
 * This tool searches through indexed artifacts (code snippets, documents, etc.)
 * stored in a SQLite database. Before using, you need to:
 * 
 * 1. Install the artifact-index: npm install -g artifact-index
 * 2. Initialize the index: artifact-index init
 * 3. Index your artifacts: artifact-index add <path>
 * 
 * If the dependency is not available, this tool returns an error message
 * explaining how to set it up.
 */

export interface ArtifactSearchArgs {
  query: string;
  limit?: number;
  type?: "code" | "doc" | "all";
}

export async function searchArtifacts(args: ArtifactSearchArgs): Promise<string> {
  // Try to use artifact-index CLI if available
  try {
    const { spawn } = await import("child_process");
    
    return new Promise((resolve, reject) => {
      const limit = args.limit ?? 10;
      const typeFilter = args.type ?? "all";
      
      const proc = spawn("artifact-index", ["search", "--query", args.query, "--limit", String(limit), "--type", typeFilter], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout?.on("data", (data) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });
      
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout || "No artifacts found matching your query.");
        } else {
          reject(new Error(`artifact-index exited with code ${code}: ${stderr}`));
        }
      });
      
      proc.on("error", (err) => {
        reject(err);
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error("artifact-index search timed out"));
      }, 30000);
    });
  } catch (error) {
    // If the command is not found or fails, provide setup instructions
    if (error instanceof Error && error.message.includes("not found")) {
      return `artifact_search requires artifact-index to be installed:
      
1. Install artifact-index CLI:
   npm install -g artifact-index

2. Initialize the database:
   artifact-index init

3. Index your artifacts:
   artifact-index add /path/to/your/code

4. Then search using this tool with your query.

Note: This tool requires the artifact-index npm package to be installed globally.`;
    }
    throw error;
  }
}

export const artifactSearchTool: ToolDefinition = tool({
  description:
    "Search through indexed artifacts (code snippets, documents) stored in SQLite. Requires artifact-index npm package to be installed. Use for finding previously indexed code or documentation.",
  args: {
    query: tool.schema
      .string()
      .describe("Search query for artifacts"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 10)"),
    type: tool.schema
      .enum(["code", "doc", "all"])
      .optional()
      .describe("Filter by type: code, doc, or all (default: all)"),
  },
  async execute(args: ArtifactSearchArgs, _context: ToolContext) {
    return searchArtifacts(args);
  },
});
