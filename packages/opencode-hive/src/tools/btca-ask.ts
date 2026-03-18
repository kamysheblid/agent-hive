import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin";

/**
 * btca_ask tool
 * 
 * Requires: btca CLI (Bluetooth Classic Audio)
 * 
 * This tool allows interaction with Bluetooth Classic Audio devices.
 * It can send commands to paired Bluetooth devices, query device status,
 * and control audio playback.
 * 
 * Before using, you need to:
 * 1. Install btca CLI: npm install -g btca-cli
 * 2. Pair your Bluetooth device
 * 3. Connect to the device: btca connect <device-name>
 * 
 * If the dependency is not available, this tool returns an error message.
 */

export interface BtcaAskArgs {
  command: "status" | "play" | "pause" | "next" | "prev" | "volume" | "list" | "connect" | "disconnect";
  device?: string;
  value?: string;
}

export async function btcaAsk(args: BtcaAskArgs): Promise<string> {
  // Try to use btca CLI if available
  try {
    const { spawn } = await import("child_process");
    
    return new Promise((resolve, reject) => {
      const cmdArgs: string[] = [args.command];
      
      if (args.device && ["connect", "disconnect"].includes(args.command)) {
        cmdArgs.push(args.device);
      }
      
      if (args.value && args.command === "volume") {
        cmdArgs.push(args.value);
      }
      
      const proc = spawn("btca", cmdArgs, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout?.on("data", (data) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data) => { stderr += data.toString(); });
      
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout || `Command ${args.command} executed successfully.`);
        } else {
          reject(new Error(`btca exited with code ${code}: ${stderr}`));
        }
      });
      
      proc.on("error", (err) => {
        reject(err);
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error("btca command timed out"));
      }, 10000);
    });
  } catch (error) {
    // If the command is not found or fails, provide setup instructions
    if (error instanceof Error && error.message.includes("not found")) {
      return `btca_ask requires btca CLI to be installed:
      
1. Install btca CLI:
   npm install -g btca-cli

2. Make sure Bluetooth is enabled on your system

3. Pair your Bluetooth audio device:
   btca pair

4. List available devices:
   btca list

5. Connect to a device:
   btca connect <device-name>

6. Then use this tool to control playback.

Note: This tool requires the btca-cli npm package and Bluetooth hardware.`;
    }
    throw error;
  }
}

export const btcaAskTool: ToolDefinition = tool({
  description:
    "Control Bluetooth Classic Audio devices. Requires btca-cli npm package. Use for playing/pausing music, controlling volume, and managing Bluetooth audio connections.",
  args: {
    command: tool.schema
      .enum(["status", "play", "pause", "next", "prev", "volume", "list", "connect", "disconnect"])
      .describe("Command to execute"),
    device: tool.schema
      .string()
      .optional()
      .describe("Device name (required for connect/disconnect commands)"),
    value: tool.schema
      .string()
      .optional()
      .describe("Value (e.g., volume level 0-100 for volume command)"),
  },
  async execute(args: BtcaAskArgs, _context: ToolContext) {
    return btcaAsk(args);
  },
});
