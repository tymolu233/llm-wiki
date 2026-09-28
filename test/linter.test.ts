import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { lintVault, formatLintReport } from '../src/core/linter.js';
import { initVault } from '../src/core/init.js';
import { reconcileIndex } from '../src/core/indexer.js';

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
    await reconcileIndex(tempDir);

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

  it('scans notes from vault root when wiki/ does not exist (root layout)', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-rootlayout-test-'));
    try {
      await fs.writeFile(path.join(rootDir, 'index.md'), '# Root Index\n', 'utf-8');
      await fs.writeFile(path.join(rootDir, 'Root Note.md'), '# Root Note\nStandalone.', 'utf-8');

      const report = await lintVault(rootDir);
      expect(report.stats.noteCount).toBe(1);
      const orphan = report.issues.find((i) => i.type === 'orphan-note');
      expect(orphan?.file).toBe('Root Note.md');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('ignores Obsidian image embeds ![[image.png]] while resolving real links', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'caller.md'),
      '# Caller\n![[diagram.png]]\nLinks to [[Other Note]].\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Other Note.md'),
      '# Other Note\nLinks back to [[caller]].\n',
      'utf-8'
    );
    await reconcileIndex(tempDir);

    const report = await lintVault(tempDir);
    expect(report.issues).toHaveLength(0);
    expect(report.stats.linkCount).toBe(2);
  });

  it('reports true file line numbers for links after a frontmatter block', async () => {
    // 4-line frontmatter block: broken link on the first body line is file line 5, not 1
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'meta.md'),
      '---\ntitle: "Meta"\ntype: concept\n---\nFirst body line with [[Missing]].\n',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const broken = report.issues.filter((i) => i.type === 'broken-link');
    expect(broken).toHaveLength(1);
    expect(broken[0].line).toBe(5);
  });

  it('reports the correct line after a multi-line HTML comment', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'commented.md'),
      '# Commented\n<!--\ncomment\n-->\nSee [[Missing]].\n',
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const broken = report.issues.filter((i) => i.type === 'broken-link');
    expect(broken).toHaveLength(1);
    expect(broken[0].line).toBe(5);
  });

  it('detects untracked notes and clears them once the index is reconciled', async () => {
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

    await reconcileIndex(tempDir);

    // Appears on disk after the index was last generated
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Gamma.md'),
      '# Gamma\nLinks to [[Alpha]].',
      'utf-8'
    );

    const staleReport = await lintVault(tempDir);
    const untracked = staleReport.issues.filter((i) => i.type === 'untracked-note');
    expect(untracked).toHaveLength(1);
    expect(untracked[0]).toMatchObject({
      type: 'untracked-note',
      severity: 'warning',
      file: 'wiki/concepts/Gamma.md',
    });
    expect(untracked[0].message).toContain('"Gamma"');

    const output = formatLintReport(staleReport);
    expect(output).toContain('Warnings (');
    expect(output).toContain('Untracked note: "Gamma" (wiki/concepts/Gamma.md)');

    await reconcileIndex(tempDir);
    const freshReport = await lintVault(tempDir);
    expect(freshReport.issues.filter((i) => i.type === 'untracked-note')).toHaveLength(0);
  });

  it('emits a single missing-index warning instead of per-note untracked entries', async () => {
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
    await fs.rm(path.join(tempDir, 'wiki', 'index.md'));
    await fs.rm(path.join(tempDir, 'index.md'), { force: true });

    const report = await lintVault(tempDir);
    const missing = report.issues.filter((i) => i.type === 'missing-index');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      severity: 'warning',
      file: 'index.md',
    });
    expect(missing[0].message).toContain('index.md is missing');
    expect(report.issues.filter((i) => i.type === 'untracked-note')).toHaveLength(0);
  });

  it('ignores note references in custom content outside the index markers', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Alpha.md'),
      '# Alpha\nLinks to [[Gamma]].',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Gamma.md'),
      '# Gamma\nLinks to [[Alpha]].',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'index.md'),
      `# Wiki Index

Custom intro mentioning [[Gamma]] outside the generated region.

<!-- LLMWIKI_INDEX_START -->
## Concepts

- [[Alpha]]
<!-- LLMWIKI_INDEX_END -->
`,
      'utf-8'
    );

    const report = await lintVault(tempDir);
    const untracked = report.issues.filter((i) => i.type === 'untracked-note');
    expect(untracked).toHaveLength(1);
    expect(untracked[0].file).toBe('wiki/concepts/Gamma.md');
  });

  it('counts a note linked by full path with alias as tracked', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Foo.md'),
      '# Foo\nA lonely note.',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'index.md'),
      `# Wiki Index

<!-- LLMWIKI_INDEX_START -->
## Concepts

| [[wiki/concepts/Foo|Foo]] | summary |
<!-- LLMWIKI_INDEX_END -->
`,
      'utf-8'
    );

    const report = await lintVault(tempDir);
    expect(report.issues.filter((i) => i.type === 'untracked-note')).toHaveLength(0);
  });
});
