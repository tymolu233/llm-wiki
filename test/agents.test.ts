import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectAgentEnvironments,
  configureAgentRules,
  configureAgentMcp,
  mergeMcpConfig,
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

      const created = await configureAgentMcp(tempDir, ['cursor']);
      expect(created).toContain('.cursor/mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);

      // Should preserve existing server
      expect(parsed.mcpServers.otherTool).toBeDefined();
      // Should add llmwiki
      expect(parsed.mcpServers.llmwiki).toBeDefined();
      expect(parsed.mcpServers.llmwiki.args).toEqual(['-y', '@tymolu/llmwiki', 'mcp']);
    });

    it('generates .mcp.json for Claude Code', async () => {
      const created = await configureAgentMcp(tempDir, ['claude']);
      expect(created).toContain('.mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .mcp.json for Universal Agents (agents / codex / antigravity)', async () => {
      const created = await configureAgentMcp(tempDir, ['agents']);
      expect(created).toContain('.mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .mcp.json for Gemini CLI', async () => {
      const created = await configureAgentMcp(tempDir, ['gemini']);
      expect(created).toContain('.mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .cline/mcp_settings.json for Cline / Roo Code', async () => {
      const created = await configureAgentMcp(tempDir, ['cline']);
      expect(created).toContain('.cline/mcp_settings.json');

      const content = await fs.readFile(path.join(tempDir, '.cline', 'mcp_settings.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.mcpServers.llmwiki).toBeDefined();
    });

    it('generates .vscode/mcp.json for VS Code / GitHub Copilot with servers key', async () => {
      const created = await configureAgentMcp(tempDir, ['copilot']);
      expect(created).toContain('.vscode/mcp.json');

      const content = await fs.readFile(path.join(tempDir, '.vscode', 'mcp.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.servers?.llmwiki || parsed.mcpServers?.llmwiki).toBeDefined();
      expect(parsed.servers?.llmwiki?.type).toBe('stdio');
    });
  });
});
