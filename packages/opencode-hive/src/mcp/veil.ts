import type { LocalMcpConfig } from './types';

/**
 * @ushiradineth/veil MCP for code discovery
 * 
 * Veil helps coding agents find the right code fast.
 * - discover: Get files, symbols, and code chunks in one step
 * - lookup: Get the most relevant context for the task
 * - files, symbols, search: Focused follow-up
 * 
 * https://github.com/ushiradineth/veil
 */

export const veilMcp: LocalMcpConfig = {
  type: 'local',
  command: ['npx', '-y', '@ushiradineth/veil@latest', 'mcp', 'server'],
};
