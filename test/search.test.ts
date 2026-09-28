import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { searchVault } from '../src/core/search.js';
import { initVault } from '../src/core/init.js';

describe('In-Vault Search Engine', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-search-test-'));
    await initVault({ vaultDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('ranks exact title and alias matches higher than body mentions', async () => {
    // Note 1: Body mention
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'consensus.md'),
      '# Distributed Consensus\nDiscusses many ideas including Paxos protocol.',
      'utf-8'
    );

    // Note 2: Exact Title
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'paxos.md'),
      '# Paxos\nThe classic consensus protocol by Leslie Lamport.',
      'utf-8'
    );

    // Note 3: Alias match
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'raft.md'),
      `---
title: "Raft"
aliases: ["Paxos Alternative"]
---
A consensus algorithm designed for ease of understanding.`,
      'utf-8'
    );

    const results = await searchVault(tempDir, 'Paxos');
    expect(results.length).toBeGreaterThanOrEqual(3);

    // Exact title should be rank 1
    expect(results[0].title).toBe('Paxos');

    // Alias match or title should be higher than mere body mention
    expect(results[1].title).toBe('Raft');
    expect(results[2].title).toBe('Distributed Consensus');
  });

  it('extracts contextual snippet around matching term', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'quantum.md'),
      `# Quantum Computing
Quantum computers leverage superposition and entanglement to perform complex computations that classical computers cannot solve efficiently.`,
      'utf-8'
    );

    const results = await searchVault(tempDir, 'entanglement');
    expect(results).toHaveLength(1);
    expect(results[0].snippet.toLowerCase()).toContain('entanglement');
    expect(results[0].snippet).toContain('superposition');
  });

  it('returns empty array when no matches are found', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'simple.md'),
      '# Simple Note\nJust regular text here.',
      'utf-8'
    );

    const results = await searchVault(tempDir, 'nonexistenttermxyz');
    expect(results).toHaveLength(0);
  });

  it('finds notes in a root-layout vault (no wiki/ directory)', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-rootsearch-test-'));
    try {
      await fs.writeFile(path.join(rootDir, 'index.md'), '# Root Index\n', 'utf-8');
      await fs.writeFile(path.join(rootDir, 'Notes.md'), '# Root Layout Note\nContains rootlayoutneedle.\n', 'utf-8');

      const results = await searchVault(rootDir, 'rootlayoutneedle');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe('Notes.md');
      expect(results[0].title).toBe('Root Layout Note');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('includes raw/ sources only when includeRaw is set', async () => {
    await fs.writeFile(path.join(tempDir, 'raw', 'source.md'), '# Raw Source\nContains rawsourceneedle.\n', 'utf-8');

    const withoutRaw = await searchVault(tempDir, 'rawsourceneedle');
    expect(withoutRaw).toHaveLength(0);

    const withRaw = await searchVault(tempDir, 'rawsourceneedle', { includeRaw: true });
    expect(withRaw).toHaveLength(1);
    expect(withRaw[0].relativePath).toBe('raw/source.md');
  });

  it('does not crash on non-string frontmatter summary', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'listsum.md'),
      '---\ntitle: "List Summary"\nsummary:\n  - first\n  - second\n---\nContains listsummaryneedle.\n',
      'utf-8'
    );

    const results = await searchVault(tempDir, 'listsummaryneedle');
    expect(results).toHaveLength(1);
  });

  it('clamps negative limits to zero results', async () => {
    await fs.writeFile(
      path.join(tempDir, 'wiki', 'concepts', 'anything.md'),
      '# Anything\nContains limitneedle.\n',
      'utf-8'
    );

    const results = await searchVault(tempDir, 'limitneedle', { limit: -1 });
    expect(results).toHaveLength(0);
  });
});
