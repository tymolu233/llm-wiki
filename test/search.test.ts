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
});
