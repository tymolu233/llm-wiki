import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initVault } from '../src/core/init.js';

describe('Vault Initialization Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-init-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('scaffolds complete vault directory structure and files', async () => {
    const result = await initVault({ vaultDir: tempDir });

    expect(result.createdFiles.length).toBeGreaterThan(0);
    expect(result.skippedFiles.length).toBe(0);

    // Verify directories
    const rawStat = await fs.stat(path.join(tempDir, 'raw'));
    expect(rawStat.isDirectory()).toBe(true);

    const entitiesStat = await fs.stat(path.join(tempDir, 'wiki', 'entities'));
    expect(entitiesStat.isDirectory()).toBe(true);

    const conceptsStat = await fs.stat(path.join(tempDir, 'wiki', 'concepts'));
    expect(conceptsStat.isDirectory()).toBe(true);

    const synthesesStat = await fs.stat(path.join(tempDir, 'wiki', 'syntheses'));
    expect(synthesesStat.isDirectory()).toBe(true);

    // Verify index.md has marker comments
    const indexContent = await fs.readFile(path.join(tempDir, 'index.md'), 'utf-8');
    expect(indexContent).toContain('<!-- LLMWIKI_INDEX_START -->');
    expect(indexContent).toContain('<!-- LLMWIKI_INDEX_END -->');

    // Verify log.md has initial entry
    const logContent = await fs.readFile(path.join(tempDir, 'log.md'), 'utf-8');
    expect(logContent).toMatch(/^## \[\d{4}-\d{2}-\d{2}\] init \| Vault initialized/m);

    // Verify AGENTS.md and CLAUDE.md exist with instructions
    const agentsContent = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(agentsContent).toContain('LLM Wiki Librarian');

    const claudeContent = await fs.readFile(path.join(tempDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('LLM Wiki Librarian');
  });

  it('is idempotent and non-destructively preserves existing files', async () => {
    // First run
    await initVault({ vaultDir: tempDir });

    // Customise AGENTS.md with user-specific rules
    const customAgents = '# Custom Agent Rules\n- My custom rule 1';
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), customAgents, 'utf-8');

    // Second run: should safely append without destroying custom rules
    const result = await initVault({ vaultDir: tempDir });

    expect(result.updatedFiles).toContain('AGENTS.md');
    const readBack = await fs.readFile(path.join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(readBack).toContain(customAgents);
    expect(readBack).toContain('## LLM Wiki Librarian');

    // Third run: already has the section, so it skips without duplicating
    const thirdRun = await initVault({ vaultDir: tempDir });
    expect(thirdRun.skippedFiles).toContain('AGENTS.md');
  });
});
