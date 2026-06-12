import { describe, expect, it } from 'bun:test';
import { openserpMcp } from './openserp.js';
import { getBuiltinMcps } from './index.js';
import { MCP_TOOLS, formatMcpToolsXml } from './mcp-info.js';

describe('OpenSERP MCP', () => {
  describe('openserpMcp config', () => {
    it('exports a valid LocalMcpConfig', () => {
      expect(openserpMcp).toBeDefined();
      expect(openserpMcp.type).toBe('local');
    });

    it('has correct command', () => {
      expect(openserpMcp.command).toEqual(['npx', '-y', '@openserp/mcp']);
    });

    it('has no environment variables', () => {
      expect(openserpMcp.environment).toBeUndefined();
    });
  });

  describe('registration in index', () => {
    it('is registered in built-in MCPs', () => {
      const mcps = getBuiltinMcps();
      expect(mcps.openserp).toBeDefined();
      expect(mcps.openserp).toBe(openserpMcp);
    });
  });

  describe('MCP_TOOLS entries', () => {
    const openSerpTools = MCP_TOOLS.filter(t => t.mcp === 'openserp');

    it('registers openserp_search tool', () => {
      const tool = openSerpTools.find(t => t.name === 'openserp_search');
      expect(tool).toBeDefined();
      expect(tool!.description).toBeTruthy();
      expect(tool!.category).toBe('search');
    });

    it('registers openserp_mega_search tool', () => {
      const tool = openSerpTools.find(t => t.name === 'openserp_mega_search');
      expect(tool).toBeDefined();
      expect(tool!.description).toBeTruthy();
      expect(tool!.category).toBe('search');
    });

    it('registers openserp_image_search tool', () => {
      const tool = openSerpTools.find(t => t.name === 'openserp_image_search');
      expect(tool).toBeDefined();
      expect(tool!.description).toBeTruthy();
      expect(tool!.category).toBe('search');
    });

    it('registers openserp_extract tool', () => {
      const tool = openSerpTools.find(t => t.name === 'openserp_extract');
      expect(tool).toBeDefined();
      expect(tool!.description).toBeTruthy();
      expect(tool!.category).toBe('search');
    });

    it('registers all expected OpenSERP tools', () => {
      const expectedTools = [
        'openserp_search',
        'openserp_mega_search',
        'openserp_image_search',
        'openserp_extract',
      ];
      const names = openSerpTools.map(t => t.name);
      for (const expected of expectedTools) {
        expect(names).toContain(expected);
      }
    });
  });

  describe('formatMcpToolsXml', () => {
    it('includes openserp tools in XML output', () => {
      const xml = formatMcpToolsXml();
      expect(xml).toContain('openserp_search');
      expect(xml).toContain('openserp_mega_search');
      expect(xml).toContain('openserp_image_search');
      expect(xml).toContain('openserp_extract');
    });
  });
});
