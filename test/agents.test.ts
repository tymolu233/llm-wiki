import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectAgentEnvironments,
  configureAgentRules,
  configureAgentMcp,
  mergeMcpConfig,
  stripJsonComments,
} from '../src/core/agents.js';

describe('Multi-Agent Adapter Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-agent-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('detectAgentEnvironments', () => {
    it('detects cursor environment if .cursor directory exists', async () => {
      await fs.mkdir(path.join(tempDir, '.cursor'));
      const detected = await detectAgentEnvironments(tempDir);
      expect(detected).toContain('cursor');
    });

    it('returns default trio if no existing markers are found', async () => {
      const detected = await detectAgentEnvironments(tempDir);
      expect(detected).toEqual(['claude', 'cursor', 'agents']);
    });
  });

  describe('configureAgentRules', () => {
    it('generates .cursor/rules/llmwiki.mdc for Cursor', async () => {
      const { created } = await configureAgentRules(tempDir, ['cursor']);
      expect(created).toContain('.cursor/rules/llmwiki.mdc');

      const content = await fs.readFile(path.join(tempDir, '.cursor', 'rules', 'llmwiki.mdc'), 'utf-8');
      expect(content).toContain('globs:');
      expect(content).toContain('LLM Wiki Librarian');
    });

    it('generates .windsurfrules for Windsurf', async () => {
      const { created } = await configureAgentRules(tempDir, ['windsurf']);
      expect(created).toContain('.windsurfrules');

      const content = await fs.readFile(path.join(tempDir, '.windsurfrules'), 'utf-8');
      expect(content).toContain('LLM Wiki Librarian');
    });

    it('generates GEMINI.md for Gemini CLI', async () => {
      const { created } = await configureAgentRules(tempDir, ['gemini']);
      expect(created).toContain('GEMINI.md');

      const content = await fs.readFile(path.join(tempDir, 'GEMINI.md'), 'utf-8');
      expect(content).toContain('LLM Wiki Librarian');
    });

    it('generates .clinerules for Cline / Roo Code', async () => {
      const { created } = await configureAgentRules(tempDir, ['cline']);
      expect(created).toContain('.clinerules');

      const content = await fs.readFile(path.join(tempDir, '.clinerules'), 'utf-8');
      expect(content).toContain('LLM Wiki Librarian');
    });

    it('NEVER overwrites existing AGENTS.md, but safely appends the wiki librarian section', async () => {
      const existingAgentsMd = `# AGENTS.md

## Existing Project Standards
- Use strict TypeScript.
- Follow Clean Architecture.
`;
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), existingAgentsMd, 'utf-8');

      const { updated, skipped } = await configureAgentRules(tempDir, ['agents']);
      expect(updated).toContain('AGENTS.md');

      const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
      // Must preserve the existing project standards!
      expect(content).toContain('## Existing Project Standards');
      expect(content).toContain('Use strict TypeScript');
      // And must have appended the LLM Wiki section!
      expect(content).toContain('## LLM Wiki Librarian');

      // Second run: should detect existing section and skip without duplicating
      const secondRun = await configureAgentRules(tempDir, ['agents']);
      expect(secondRun.skipped).toContain('AGENTS.md');
    });
  });

  describe('configureAgentMcp', () => {
    it('generates .cursor/mcp.json and merges existing servers safely', async () => {
      await fs.mkdir(path.join(tempDir, '.cursor'), { recursive: true });
      const existingConfig = {
        mcpServers: {
          otherTool: {
            command: 'other',
            args: [],
          },
        },
      };
      await fs.writeFile(path.join(tempDir, '.cursor', 'mcp.json'), JSON.stringify(existingConfig, null, 2), 'utf-8');

      const { updatedFiles } = await configureAgentMcp(tempDir, ['cursor']);
      expect(updatedFiles).toContain('.cursor/mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);

      // Should preserve existing server
      expect(parsed.mcpServers.otherTool).toBeDefined();
      // Should add llmwiki
      expect(parsed.mcpServers.llmwiki).toBeDefined();
      expect(parsed.mcpServers.llmwiki.args).toEqual(['-y', '@tymolu/llmwiki', 'mcp']);
    });

    it('never overwrites a malformed existing .mcp.json and reports the skip', async () => {
      // Unterminated braces: invalid JSON, and comment-stripping won't save it
      const malformed = '{\n  "mcpServers": {\n    "broken": {\n';
      const mcpPath = path.join(tempDir, '.mcp.json');
      await fs.writeFile(mcpPath, malformed, 'utf-8');

      const { updatedFiles, skippedConfigs } = await configureAgentMcp(tempDir, ['claude']);
      expect(updatedFiles).not.toContain('.mcp.json');
      expect(skippedConfigs).toHaveLength(1);
      expect(skippedConfigs[0].file).toBe('.mcp.json');
      expect(skippedConfigs[0].reason).toContain('could not be parsed');

      // File content must be byte-identical to before
      const after = await fs.readFile(mcpPath, 'utf-8');
      expect(after).toBe(malformed);
    });

    it('generates .mcp.json for Claude Code', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['claude']);
      expect(updatedFiles).toContain('.mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .mcp.json and Antigravity workspace plugin for agents', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['agents']);
      expect(updatedFiles).toContain('.mcp.json');
      expect(updatedFiles).toContain('.agents/plugins/llmwiki/mcp_config.json');

      const mcpJson = JSON.parse(await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8'));
      expect(mcpJson.mcpServers.llmwiki).toBeDefined();

      const pluginJson = JSON.parse(
        await fs.readFile(path.join(tempDir, '.agents', 'plugins', 'llmwiki', 'plugin.json'), 'utf-8')
      );
      expect(pluginJson.name).toBe('llmwiki');

      const pluginMcp = JSON.parse(
        await fs.readFile(path.join(tempDir, '.agents', 'plugins', 'llmwiki', 'mcp_config.json'), 'utf-8')
      );
      expect(pluginMcp.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .gemini/settings.json and .mcp.json for Gemini CLI / Code Assist', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['gemini']);
      expect(updatedFiles).toContain('.mcp.json');
      expect(updatedFiles).toContain('.gemini/settings.json');

      const settings = JSON.parse(await fs.readFile(path.join(tempDir, '.gemini', 'settings.json'), 'utf-8'));
      expect(settings.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .cline/mcp.json, .cline/mcp_settings.json, and .roo/mcp.json for Cline / Roo Code', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['cline']);
      expect(updatedFiles).toContain('.cline/mcp_settings.json');
      expect(updatedFiles).toContain('.cline/mcp.json');
      expect(updatedFiles).toContain('.roo/mcp.json');

      const rooMcp = JSON.parse(await fs.readFile(path.join(tempDir, '.roo', 'mcp.json'), 'utf-8'));
      expect(rooMcp.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .vscode/mcp.json for VS Code / GitHub Copilot with servers key', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['copilot']);
      expect(updatedFiles).toContain('.vscode/mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.vscode', 'mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.servers?.llmwiki || parsed.mcpServers?.llmwiki).toBeDefined();
      expect(parsed.servers?.llmwiki?.type).toBe('stdio');
    });

    it('generates .windsurf/mcp.json and .codeium/windsurf/mcp_config.json for Windsurf', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['windsurf']);
      expect(updatedFiles).toContain('.windsurf/mcp.json');
      expect(updatedFiles).toContain('.codeium/windsurf/mcp_config.json');

      const windsurfMcp = JSON.parse(await fs.readFile(path.join(tempDir, '.windsurf', 'mcp.json'), 'utf-8'));
      expect(windsurfMcp.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .continue/mcpServers/llmwiki.yaml for Continue.dev', async () => {
      const { updatedFiles } = await configureAgentMcp(tempDir, ['continue']);
      expect(updatedFiles).toContain('.continue/mcpServers/llmwiki.yaml');

      const yamlContent = await fs.readFile(
        path.join(tempDir, '.continue', 'mcpServers', 'llmwiki.yaml'),
        'utf-8'
      );
      expect(yamlContent).toContain('name: llmwiki');
      expect(yamlContent).toContain('@tymolu/llmwiki');
    });
  });

  describe('stripJsonComments & JSONC resilience', () => {
    it('safely strips single-line and multi-line comments from JSONC', () => {
      const jsonc = `{
        // Line comment
        "name": "test",
        /* Block comment
           multiline */
        "url": "https://example.com/api", // comment with URL
        "items": [1, 2, 3,],
      }`;

      const stripped = stripJsonComments(jsonc);
      const parsed = JSON.parse(stripped);
      expect(parsed.name).toBe('test');
      expect(parsed.url).toBe('https://example.com/api');
      expect(parsed.items).toEqual([1, 2, 3]);
    });

    it('merges MCP configuration cleanly into existing JSONC containing comments without losing existing keys', () => {
      const existingJsonc = `{
        // Development database MCP server
        "mcpServers": {
          "db": {
            "command": "db-tool",
            "args": ["serve"],
          },
        },
      }`;

      const result = mergeMcpConfig(existingJsonc, 'llmwiki', {
        command: 'npx',
        args: ['-y', '@tymolu/llmwiki', 'mcp'],
      });

      const parsed = JSON.parse(result);
      expect(parsed.mcpServers.db).toBeDefined();
      expect(parsed.mcpServers.llmwiki).toBeDefined();
      expect(parsed.mcpServers.llmwiki.command).toBe('npx');
    });

    it('mergeMcpConfig throws on unparseable existing content instead of silently dropping it', () => {
      expect(() => mergeMcpConfig('{ "mcpServers": {', 'llmwiki', { command: 'npx' })).toThrow(
        /could not be parsed/
      );
    });

    it('mergeMcpConfig still creates a fresh config from empty content', () => {
      const result = mergeMcpConfig('', 'llmwiki', { command: 'npx' });
      expect(JSON.parse(result).mcpServers.llmwiki.command).toBe('npx');
    });
  });
});
