import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli } from '../src/cli.js';
import { initVault } from '../src/core/init.js';

describe('CLI runner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-cli-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs "llmwiki init <path>" and scaffolds target directory', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir]);
    expect(exitCode).toBe(0);

    const existsRaw = await fs.stat(path.join(tempDir, 'raw'));
    expect(existsRaw.isDirectory()).toBe(true);

    const existsIndex = await fs.stat(path.join(tempDir, 'wiki', 'index.md'));
    expect(existsIndex.isFile()).toBe(true);
    const existsLog = await fs.stat(path.join(tempDir, 'wiki', 'log.md'));
    expect(existsLog.isFile()).toBe(true);
  });

  it('runs "llmwiki init <path> --root-index" and places index.md and log.md in root', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--root-index']);
    expect(exitCode).toBe(0);

    const existsIndex = await fs.stat(path.join(tempDir, 'index.md'));
    expect(existsIndex.isFile()).toBe(true);
    const existsLog = await fs.stat(path.join(tempDir, 'log.md'));
    expect(existsLog.isFile()).toBe(true);
  });

  it('prints help when called with --help', async () => {
    const exitCode = await runCli(['node', 'llmwiki', '--help']);
    expect(exitCode).toBe(0);
  });

  it('prints version when called with --version', async () => {
    const exitCode = await runCli(['node', 'llmwiki', '--version']);
    expect(exitCode).toBe(0);
  });

  it('returns 1 on unknown commands', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'nonexistent-cmd']);
    expect(exitCode).toBe(1);
  });

  it('runs "llmwiki lint <path>" and detects issues or success', async () => {
    await runCli(['node', 'llmwiki', 'init', tempDir]);
    const exitCode = await runCli(['node', 'llmwiki', 'lint', tempDir]);
    // Vault with no notes is clean (0 exit code)
    expect(exitCode).toBe(0);
  });

  it('runs "llmwiki status <path>" and outputs status dashboard', async () => {
    await runCli(['node', 'llmwiki', 'init', tempDir]);
    const exitCode = await runCli(['node', 'llmwiki', 'status', tempDir]);
    expect(exitCode).toBe(0);

    const jsonExit = await runCli(['node', 'llmwiki', 'status', tempDir, '--json']);
    expect(jsonExit).toBe(0);
  });

  it('runs "llmwiki index <path>" and rebuilds index.md', async () => {
    await runCli(['node', 'llmwiki', 'init', tempDir]);
    const exitCode = await runCli(['node', 'llmwiki', 'index', tempDir]);
    expect(exitCode).toBe(0);
  });

  it('runs "llmwiki search <query>" and prints results', async () => {
    await runCli(['node', 'llmwiki', 'init', tempDir]);
    await fs.writeFile(path.join(tempDir, 'wiki', 'concepts', 'Raft.md'), '# Raft\nConsensus algorithm.', 'utf-8');

    const exitCode = await runCli(['node', 'llmwiki', 'search', 'Raft', tempDir]);
    expect(exitCode).toBe(0);

    const jsonExitCode = await runCli(['node', 'llmwiki', 'search', 'Raft', tempDir, '--json']);
    expect(jsonExitCode).toBe(0);
  });

  it('runs "llmwiki init <path> --all" to configure all agents and MCP', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--all']);
    expect(exitCode).toBe(0);

    // Cursor rule + mcp
    const cursorRule = await fs.readFile(path.join(tempDir, '.cursor', 'rules', 'llmwiki.mdc'), 'utf-8');
    expect(cursorRule).toContain('LLM Wiki Librarian');
    const cursorMcp = await fs.readFile(path.join(tempDir, '.cursor', 'mcp.json'), 'utf-8');
    expect(cursorMcp).toContain('llmwiki');

    // Claude CLAUDE.md + .mcp.json
    const claudeMd = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('## LLM Wiki Librarian');
    const claudeMcp = await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8');
    expect(claudeMcp).toContain('llmwiki');

    // Generic AGENTS.md
    const agentsMd = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('## LLM Wiki Librarian');

    // Cline, Zed
    const clineMcp = await fs.readFile(path.join(tempDir, '.cline', 'mcp_settings.json'), 'utf-8');
    expect(clineMcp).toContain('llmwiki');
    const zedMcp = await fs.readFile(path.join(tempDir, '.zed', 'settings.json'), 'utf-8');
    expect(zedMcp).toContain('llmwiki');
  });

  it('runs "llmwiki init <path> --agent cursor,claude --no-mcp"', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--agent', 'cursor,claude', '--no-mcp']);
    expect(exitCode).toBe(0);

    const cursorRuleExists = await fs.stat(path.join(tempDir, '.cursor', 'rules', 'llmwiki.mdc')).then(() => true).catch(() => false);
    expect(cursorRuleExists).toBe(true);

    const claudeMdExists = await fs.stat(path.join(tempDir, 'CLAUDE.md')).then(() => true).catch(() => false);
    expect(claudeMdExists).toBe(true);

    // No MCP files should have been created because --no-mcp was passed
    const mcpExists = await fs.stat(path.join(tempDir, '.mcp.json')).then(() => true).catch(() => false);
    expect(mcpExists).toBe(false);
  });

  it('fails with exit code 1 when given invalid agent name', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--agent', 'invalidagent']);
    expect(exitCode).toBe(1);
  });

  it('non-destructively appends to existing AGENTS.md without destroying user content', async () => {
    const initialContent = '# Custom User Agents\n\n- Do not touch my custom workflows!\n';
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), initialContent, 'utf-8');

    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--agent', 'agents']);
    expect(exitCode).toBe(0);

    const content = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Custom User Agents');
    expect(content).toContain('- Do not touch my custom workflows!');
    expect(content).toContain('## LLM Wiki Librarian');

    // Running a second time should be idempotent and not duplicate
    const secondCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--agent', 'agents']);
    expect(secondCode).toBe(0);

    const content2 = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    const matches = content2.match(/## LLM Wiki Librarian/g);
    expect(matches).toHaveLength(1);
  });

  it('init leaves a malformed .mcp.json untouched, reports the skip, and still exits 0', async () => {
    // Unterminated braces: invalid JSON
    const malformed = '{\n  "mcpServers": {\n    "broken": {\n';
    const mcpPath = path.join(tempDir, '.mcp.json');
    await fs.writeFile(mcpPath, malformed, 'utf-8');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let exitCode = -1;
    try {
      exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '--agent', 'claude']);
    } finally {
      const out = logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      logSpy.mockRestore();

      expect(exitCode).toBe(0);
      // The malformed config must be byte-identical to before
      const after = await fs.readFile(mcpPath, 'utf-8');
      expect(after).toBe(malformed);
      // And a warning line should mention it was left untouched
      expect(out).toContain('.mcp.json');
      expect(out).toContain('left untouched');
    }
  });

  it('initVault result records skipped MCP configs for malformed files', async () => {
    const malformed = '{ "mcpServers": {';
    await fs.writeFile(path.join(tempDir, '.mcp.json'), malformed, 'utf-8');

    const result = await initVault({ vaultDir: tempDir, agents: ['claude'] });
    expect(result.skippedMcpConfigs).toHaveLength(1);
    expect(result.skippedMcpConfigs[0].file).toBe('.mcp.json');
    expect(result.skippedMcpConfigs[0].reason).toContain('could not be parsed');
  });

  it('fails with exit code 1 when -a/--agent is given without a value', async () => {
    const exitCode = await runCli(['node', 'llmwiki', 'init', tempDir, '-a']);
    expect(exitCode).toBe(1);

    const exitCode2 = await runCli(['node', 'llmwiki', 'init', tempDir, '--agent']);
    expect(exitCode2).toBe(1);
  });

  it('rejects unknown flags for "status" like -h (positional path detection ignores flags)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = await runCli(['node', 'llmwiki', 'status', '-h']);
      expect(exitCode).toBe(1);
      const messages = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(messages).toContain('Unknown flag');
      expect(messages).not.toContain('Failed to get vault status');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('rejects unknown flags for "lint" like --json', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = await runCli(['node', 'llmwiki', 'lint', '--json']);
      expect(exitCode).toBe(1);
      const messages = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(messages).toContain('Unknown flag');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('rejects unknown flags for "index" like --json', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = await runCli(['node', 'llmwiki', 'index', '--json']);
      expect(exitCode).toBe(1);
      const messages = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(messages).toContain('Unknown flag');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('search accepts --json before the vault path and returns JSON for that vault', async () => {
    await runCli(['node', 'llmwiki', 'init', tempDir]);
    await fs.writeFile(path.join(tempDir, 'wiki', 'concepts', 'Zebra.md'), '# Zebra\nA striped animal.', 'utf-8');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let exitCode = -1;
    try {
      exitCode = await runCli(['node', 'llmwiki', 'search', 'Zebra', '--json', tempDir]);
    } finally {
      const out = logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      logSpy.mockRestore();

      expect(exitCode).toBe(0);
      const results = JSON.parse(out);
      expect(Array.isArray(results)).toBe(true);
      expect(results.some((r: any) => r.title === 'Zebra')).toBe(true);
    }
  });

  it('mcp with a nonexistent or non-directory path exits 1 without starting the server', async () => {
    const missing = path.join(tempDir, 'does-not-exist');
    const exitCode = await runCli(['node', 'llmwiki', 'mcp', missing]);
    expect(exitCode).toBe(1);

    const filePath = path.join(tempDir, 'a-file.md');
    await fs.writeFile(filePath, 'not a directory', 'utf-8');
    const exitCode2 = await runCli(['node', 'llmwiki', 'mcp', filePath]);
    expect(exitCode2).toBe(1);
  });
});
