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
});
