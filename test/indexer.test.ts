import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { reconcileIndex } from '../src/core/indexer.js';
import { initVault, INDEX_MARKER_START, INDEX_MARKER_END } from '../src/core/init.js';
import { resolveIndexPath } from '../src/core/storage.js';

describe('Catalog Index Reconciler', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-indexer-test-'));
    await initVault({ vaultDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates categorized tables with backlinks and summaries', async () => {
    // Concept Note
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Raft.md'),
      `---
title: "Raft"
type: concept
summary: "Consensus algorithm designed for understandability"
last_updated: "2026-04-01"
---
Details about Raft.`,
      'utf-8'
    );

    // Entity Note linking to Raft
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'entities', 'etcd.md'),
      `---
title: "etcd"
type: entity
summary: "Distributed key-value store"
last_updated: "2026-04-02"
---
Uses [[Raft]] for consensus.`,
      'utf-8'
    );

    // Synthesis Note
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'syntheses', 'consensus-survey.md'),
      `---
title: "Consensus Survey"
type: synthesis
summary: "Comparison of consensus protocols"
last_updated: "2026-04-03"
---
Compares [[Raft]] and Paxos.`,
      'utf-8'
    );

    const result = await reconcileIndex(tempDir);
    expect(result.totalNotes).toBe(3);
    expect(result.conceptCount).toBe(1);
    expect(result.entityCount).toBe(1);
    expect(result.synthesisCount).toBe(1);

    const indexPath = await resolveIndexPath(tempDir);
    const indexContent = await fs.readFile(indexPath, 'utf-8');

    // Check Raft in Concepts table with 2 backlinks (etcd + consensus-survey)
    expect(indexContent).toContain('| [[Raft]] | Consensus algorithm designed for understandability | 2 | 2026-04-01 |');

    // Check etcd in Entities table
    expect(indexContent).toContain('| [[etcd]] | Distributed key-value store | 0 | 2026-04-02 |');

    // Check Consensus Survey in Syntheses table
    expect(indexContent).toContain('| [[Consensus Survey]] | Comparison of consensus protocols | 0 | 2026-04-03 |');
  });

  it('preserves custom user content outside markers', async () => {
    const indexPath = await resolveIndexPath(tempDir);
    const customHeader = `# My Personal Knowledge Base\n\n> "Knowledge is compound interest." - Naval Ravikant\n\nHere are my favorite pinned topics.\n\n`;
    const customFooter = `\n\n## Custom Notes Section\n- Remember to backup weekly.\n`;

    const customIndex = `${customHeader}${INDEX_MARKER_START}\nold stuff\n${INDEX_MARKER_END}${customFooter}`;
    await fs.writeFile(indexPath, customIndex, 'utf-8');

    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'AI.md'),
      `---
title: "Artificial Intelligence"
type: concept
summary: "Machine intelligence studies"
---
Content.`,
      'utf-8'
    );

    await reconcileIndex(tempDir);

    const updatedIndex = await fs.readFile(indexPath, 'utf-8');
    expect(updatedIndex).toContain(customHeader.trim());
    expect(updatedIndex).toContain(customFooter.trim());
    expect(updatedIndex).toContain('[[Artificial Intelligence]]');
  });

  it('is completely idempotent when run multiple times', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'Note1.md'),
      '# Note 1\nContent',
      'utf-8'
    );

    const indexPath = await resolveIndexPath(tempDir);
    await reconcileIndex(tempDir);
    const firstRun = await fs.readFile(indexPath, 'utf-8');

    await reconcileIndex(tempDir);
    const secondRun = await fs.readFile(indexPath, 'utf-8');

    expect(firstRun).toBe(secondRun);
  });

  it('falls back to root index.md if present and updates it', async () => {
    const legacyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-legacy-'));
    try {
      await fs.mkdir(path.join(legacyDir, 'wiki', 'concepts'), { recursive: true });
      await fs.writeFile(
        path.join(legacyDir, 'index.md'),
        `# Root Index\n${INDEX_MARKER_START}\n${INDEX_MARKER_END}\n`,
        'utf-8'
      );
      await fs.writeFile(
        path.join(legacyDir, 'wiki', 'concepts', 'Legacy.md'),
        '---\ntitle: "Legacy"\ntype: concept\nsummary: "Legacy concept"\n---\nBody',
        'utf-8'
      );

      const stats = await reconcileIndex(legacyDir);
      expect(stats.totalNotes).toBe(1);

      const rootContent = await fs.readFile(path.join(legacyDir, 'index.md'), 'utf-8');
      expect(rootContent).toContain('| [[Legacy]] | Legacy concept | 0 |');
    } finally {
      await fs.rm(legacyDir, { recursive: true, force: true });
    }
  });
});
