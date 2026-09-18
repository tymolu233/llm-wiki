import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli } from '../src/cli.js';

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

    const existsIndex = await fs.stat(path.join(tempDir, 'index.md'));
    expect(existsIndex.isFile()).toBe(true);
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
});
