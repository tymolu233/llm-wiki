import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { lintVault } from '../src/core/linter.js';
import { initVault } from '../src/core/init.js';

describe('Vault Linter Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-linter-test-'));
    await initVault({ vaultDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reports no errors for cleanly linked notes', async () => {
    // Note 1 links to Note 2, Note 2 links to Note 1
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Alpha.md'),
      '# Alpha\nLinks to [[Beta]].',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Beta.md'),
      '# Beta\nLinks to [[Alpha]].',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    expect(report.stats.brokenCount).toBe(0);
    expect(report.stats.orphanCount).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it('detects broken links with line numbers and targets', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'caller.md'),
      '# Caller\nLine 2\nLine 3 with [[Nonexistent Note]].',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const broken = report.issues.filter((i) => i.type === 'broken-link');
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({
      type: 'broken-link',
      target: 'Nonexistent Note',
      line: 3,
    });
  });

  it('detects orphan notes with zero inbound links', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'lonely.md'),
      '# Lonely Note\nNo one links to me.',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const orphans = report.issues.filter((i) => i.type === 'orphan-note');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].file).toContain('lonely.md');
  });

  it('resolves links via frontmatter aliases without reporting broken link', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'consensus.md'),
      `---
title: "Distributed Consensus"
aliases: ["Consensus Algorithm"]
---
Body text.`,
      'utf-8'
    );

    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'raft.md'),
      '# Raft\nImplements [[Consensus Algorithm]].',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const broken = report.issues.filter((i) => i.type === 'broken-link');
    expect(broken).toHaveLength(0);
  });

  it('warns on case-mismatch links', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Transformer.md'),
      '# Transformer\nCore architecture.',
      'utf-8'
    );

    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'bert.md'),
      '# BERT\nBased on [[transformer]].',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const caseWarnings = report.issues.filter((i) => i.type === 'case-mismatch');
    expect(caseWarnings).toHaveLength(1);
    expect(caseWarnings[0]).toMatchObject({
      type: 'case-mismatch',
      target: 'transformer',
      expected: 'Transformer',
    });
  });

  it('reports case-insensitive name collisions between distinct notes', async () => {
    // Two notes whose titles collide case-insensitively — ambiguous link resolution
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Alpha.md'),
      '# Alpha\nFirst.',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'entities', 'Beta.md'),
      '---\ntitle: "ALPHA"\ntype: entity\n---\n# ALPHA\nSecond.',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const collisions = report.issues.filter((i) => i.type === 'case-collision');
    expect(collisions).toHaveLength(1);
    expect(collisions[0].severity).toBe('error');
    expect(collisions[0].message).toContain('Alpha.md');
    expect(collisions[0].message).toContain('Beta.md');
    expect(report.stats.caseCollisionCount).toBe(1);
  });

  it('scans notes from vault root when wiki/ has no notes', async () => {
    // Root-level vault (no notes under wiki/)
    await fs.writeFile(path.join(tempDir, 'Root Note.md'), '# Root Note\nStandalone.', 'utf-8');

    const report = await lintVault(tempDir);
    expect(report.stats.noteCount).toBe(1);
    const orphan = report.issues.find((i) => i.type === 'orphan-note');
    expect(orphan?.file).toBe('Root Note.md');
  });
});
