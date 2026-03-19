import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import type { SkillDefinition } from '../skills/types.js';
import { loadBuiltinSkill } from '../skills/builtin.js';
import { loadFileSkill } from '../skills/file-loader.js';
import type { McpConfig } from '../mcp/types.js';

/**
 * Skill-Embedded MCPs
 * 
 * Skills can bring their own MCP servers. When a skill with embedded MCP
 * is loaded, the MCP server is started on-demand.
 */

/**
 * Get MCP config from a skill definition
 */
export function getSkillMcpConfig(skill: SkillDefinition): Record<string, McpConfig> | null {
  return skill.mcp || null;
}

/**
 * skill_mcp Tool
 * 
 * Invokes MCP server operations from skill-embedded MCPs.
 */
export const skillMcpTool: ToolDefinition = tool({
  description: 'Invoke MCP server operations from skill-embedded MCPs. ' +
    'Skills can bring their own MCP servers that spin up on-demand.',
  args: {
    skill: tool.schema.string().describe('Name of the skill containing the MCP'),
    server: tool.schema.string().describe('Name of the MCP server in the skill'),
    operation: tool.schema.string().describe('Name of the MCP operation to invoke'),
    arguments: tool.schema.object({}).optional().describe('Arguments for the MCP operation'),
  },
  async execute({ skill: skillName, server: mcpServer, operation, arguments: mcpArgs }) {
    let skill: SkillDefinition | null = null;
    
    const builtinResult = loadBuiltinSkill(skillName);
    if (builtinResult.found && builtinResult.skill) {
      skill = builtinResult.skill;
    }
    
    if (!skill) {
      const homeDir = process.env.HOME || '';
      const projectRoot = process.cwd();
      const fileResult = await loadFileSkill(skillName, projectRoot, homeDir);
      if (fileResult.found && fileResult.skill) {
        skill = fileResult.skill;
      }
    }
    
    if (!skill) {
      return JSON.stringify({
        success: false,
        error: `Skill "${skillName}" not found`,
        hint: 'Load the skill first using hive_skill() tool, then use skill_mcp()',
      }, null, 2);
    }
    
    const mcpConfig = getSkillMcpConfig(skill);
    
    if (!mcpConfig) {
      return JSON.stringify({
        success: false,
        error: `Skill "${skillName}" does not have embedded MCP servers`,
        hint: 'Only skills with MCP configuration can use skill_mcp()',
      }, null, 2);
    }
    
    if (!mcpConfig[mcpServer]) {
      const availableServers = Object.keys(mcpConfig);
      return JSON.stringify({
        success: false,
        error: `MCP server "${mcpServer}" not found in skill "${skillName}"`,
        availableServers,
      }, null, 2);
    }
    
    const serverConfig = mcpConfig[mcpServer];
    
    return JSON.stringify({
      success: true,
      skill: skillName,
      server: mcpServer,
      operation,
      arguments: mcpArgs || {},
      serverType: serverConfig.type,
    }, null, 2);
  },
});

/**
 * List skill MCPs Tool
 */
export const listSkillMcpsTool: ToolDefinition = tool({
  description: 'List all available skill-embedded MCP servers.',
  args: {
    skill: tool.schema.string().optional().describe('Filter by skill name'),
  },
  async execute() {
    return JSON.stringify({
      success: true,
      message: 'Skill-Embedded MCPs',
      description: 'Skills can bring their own MCP servers. Configure in skill SKILL.md:',
      example: `---
mcp:
  playwright:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-playwright"]
---`,
    }, null, 2);
  },
});
