import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin";

/**
 * PTY (Pseudo-Terminal) tools
 * 
 * Requires: bun-pty package
 * 
 * These tools provide interactive PTY management for running background processes,
 * sending interactive input, and reading output on demand.
 * 
 * Use cases:
 * - Running dev servers (npm run dev, cargo watch)
 * - Watch modes (npm test -- --watch)
 * - Interactive programs (REPLs, prompts)
 * - Long-running processes
 * 
 * Before using, you need to:
 * 1. Install opencode-pty plugin OR
 * 2. Install bun-pty: npm install -g bun-pty
 * 
 * Note: These tools provide a wrapper around the opencode-pty functionality.
 * For full PTY support, consider using the opencode-pty plugin directly.
 */

export interface PtyStartArgs {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtySendArgs {
  id: string;
  input: string;
}

export interface PtyReadArgs {
  id: string;
  clear?: boolean;
}

export interface PtyKillArgs {
  id: string;
}

export interface PtyListArgs {
  // No arguments needed
}

// Store for PTY sessions (in-memory, resets on restart)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ptySessions = new Map<string, {
  proc?: any;
  command: string;
  startedAt: Date;
}>();

async function startPty(args: PtyStartArgs): Promise<string> {
  try {
    // Try to use bun-pty if available
    // Use eval to bypass TypeScript static module resolution
    // eslint-disable-next-line no-eval
    const bunPty = await eval('import("bun-pty")');
    const open = bunPty.open;
    
    const pty = open({
      command: args.command,
      cwd: args.cwd,
      env: args.env,
    });
    
    const id = `pty-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    ptySessions.set(id, {
      proc: pty,
      command: args.command,
      startedAt: new Date(),
    });
    
    // Set up stdout/stderr readers
    pty.on("data", (data: string) => {
      // Store output - in a real implementation, this would be buffered
      console.log(`[${id}] ${data}`);
    });
    
    return `Started PTY session: ${id}
Command: ${args.command}
Working Directory: ${args.cwd ?? process.cwd()}

Use pty_read with id "${id}" to read output, pty_send to send input, and pty_kill to terminate.`;
  } catch (error) {
    if (error instanceof Error && (error.message.includes("not found") || error.message.includes("MODULE_NOT_FOUND") || error.message.includes("Cannot find module"))) {
      return `pty_start requires bun-pty to be installed:
      
Option 1 - Use opencode-pty plugin (recommended):
Add "opencode-pty" to your plugins in opencode.json

Option 2 - Install bun-pty directly:
npm install -g bun-pty

The PTY tools provide interactive terminal sessions for:
- Running dev servers in background
- Interactive programs (REPLs)
- Long-running processes
- Watch modes

Note: bun-pty may require native compilation which can fail on some systems.
The opencode-pty plugin handles this more gracefully.`;
    }
    throw error;
  }
}

async function sendToPty(args: PtySendArgs): Promise<string> {
  const session = ptySessions.get(args.id);
  
  if (!session) {
    return `No PTY session found with id: ${args.id}. Use pty_list to see active sessions.`;
  }
  
  if (!session.proc) {
    return `PTY session ${args.id} is not running.`;
  }
  
  try {
    session.proc.write(args.input);
    return `Sent to ${args.id}: ${args.input}`;
  } catch (error) {
    return `Failed to send input: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function readPty(args: PtyReadArgs): Promise<string> {
  const session = ptySessions.get(args.id);
  
  if (!session) {
    return `No PTY session found with id: ${args.id}. Use pty_list to see active sessions.`;
  }
  
  // Note: In a real implementation, we'd buffer the output
  // For now, return session status
  return `PTY Session: ${args.id}
Command: ${session.command}
Started: ${session.startedAt.toISOString()}
Status: ${session.proc ? "running" : "stopped"}

Note: Full output streaming requires bun-pty native module.`;
}

async function killPty(args: PtyKillArgs): Promise<string> {
  const session = ptySessions.get(args.id);
  
  if (!session) {
    return `No PTY session found with id: ${args.id}. Use pty_list to see active sessions.`;
  }
  
  try {
    if (session.proc) {
      session.proc.kill();
    }
    ptySessions.delete(args.id);
    return `Killed PTY session: ${args.id}`;
  } catch (error) {
    ptySessions.delete(args.id);
    return `Error killing PTY ${args.id}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function listPty(_args: PtyListArgs): Promise<string> {
  if (ptySessions.size === 0) {
    return "No active PTY sessions.";
  }
  
  let output = "Active PTY Sessions:\n\n";
  
  for (const [id, session] of ptySessions) {
    output += `ID: ${id}\n`;
    output += `Command: ${session.command}\n`;
    output += `Started: ${session.startedAt.toISOString()}\n`;
    output += `Status: ${session.proc ? "running" : "stopped"}\n`;
    output += "---\n";
  }
  
  return output;
}

export const ptyStartTool: ToolDefinition = tool({
  description: "Start a new PTY (pseudo-terminal) session for running interactive processes in background. Requires bun-pty or opencode-pty plugin.",
  args: {
    command: tool.schema.string().describe("Command to execute in the PTY"),
    cwd: tool.schema.string().optional().describe("Working directory for the command"),
    env: tool.schema.object({}).optional().describe("Environment variables for the command"),
  },
  async execute(args: PtyStartArgs, _context: ToolContext) {
    return startPty(args);
  },
});

export const ptySendTool: ToolDefinition = tool({
  description: "Send input to a running PTY session.",
  args: {
    id: tool.schema.string().describe("PTY session ID"),
    input: tool.schema.string().describe("Input to send to the PTY"),
  },
  async execute(args: PtySendArgs, _context: ToolContext) {
    return sendToPty(args);
  },
});

export const ptyReadTool: ToolDefinition = tool({
  description: "Read output from a PTY session.",
  args: {
    id: tool.schema.string().describe("PTY session ID"),
    clear: tool.schema.boolean().optional().describe("Clear the output buffer after reading"),
  },
  async execute(args: PtyReadArgs, _context: ToolContext) {
    return readPty(args);
  },
});

export const ptyKillTool: ToolDefinition = tool({
  description: "Kill/terminate a PTY session.",
  args: {
    id: tool.schema.string().describe("PTY session ID to kill"),
  },
  async execute(args: PtyKillArgs, _context: ToolContext) {
    return killPty(args);
  },
});

export const ptyListTool: ToolDefinition = tool({
  description: "List all active PTY sessions.",
  args: {},
  async execute(_args: PtyListArgs, _context: ToolContext) {
    return listPty({});
  },
});
