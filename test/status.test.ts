import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initVault } from '../src/core/init.js';
import { getVaultStatus, formatVaultStatus } from '../src/core/status.js';

describe('Vault Status Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-status-test-'));
    await initVault({ vaultDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('calculates status for an empty vault', async () => {
    const status = await getVaultStatus(tempDir);
    expect(status.notes.total).toBe(0);
    expect(status.notes.concepts).toBe(0);
    expect(status.sources.totalRaw).toBe(0);
    expect(status.sources.pendingRaw.length).toBe(0);
    expect(status.graph.totalLinks).toBe(0);
  });

  it('identifies pending uncompiled raw sources and compiled sources', async () => {
    // 1. Add raw sources
    const rawFile1 = path.join(tempDir, 'raw', 'paper1.pdf');
    const rawFile2 = path.join(tempDir, 'raw', 'interview.txt');
    await fs.writeFile(rawFile1, 'Binary PDF mock content');
    await fs.writeFile(rawFile2, 'Transcript of developer interview');

    // 2. Add concept note that compiles paper1.pdf
    const conceptPath = path.join(tempDir, 'wiki', 'concepts', 'Raft Consensus.md');
    await fs.writeFile(
      conceptPath,
      `---
title: Raft Consensus
type: concept
sources: ["raw/paper1.pdf"]
---
# Raft Consensus
Detailed consensus algorithm notes.`
    );

    const status = await getVaultStatus(tempDir);
    expect(status.notes.total).toBe(1);
    expect(status.notes.concepts).toBe(1);
    expect(status.sources.totalRaw).toBe(2);
    expect(status.sources.compiledRaw).toBe(1);
    expect(status.sources.pendingRaw).toEqual(['raw/interview.txt']);

    // Check formatted text output
    const formatted = formatVaultStatus(status);
    expect(formatted).toContain('Pending Compilation');
    expect(formatted).toContain('raw/interview.txt');
  });

  it('tracks central hubs based on inbound backlinks', async () => {
    // Note A: Central Concept
    const noteA = path.join(tempDir, 'wiki', 'concepts', 'Central Hub.md');
    await fs.writeFile(
      noteA,
      `---
title: Central Hub
type: concept
---
# Central Hub
Core architecture hub.`
    );

    // Note B: Links to A
    const noteB = path.join(tempDir, 'wiki', 'concepts', 'Client Note.md');
    await fs.writeFile(
      noteB,
      `---
title: Client Note
type: concept
---
# Client Note
Depends on [[Central Hub]].`
    );

    // Note C: Also links to A
    const noteC = path.join(tempDir, 'wiki', 'entities', 'Tool C.md');
    await fs.writeFile(
      noteC,
      `---
title: Tool C
type: entity
---
# Tool C
Implements [[Central Hub]].`
    );

    const status = await getVaultStatus(tempDir);
    expect(status.notes.total).toBe(3);
    expect(status.graph.totalLinks).toBe(2);
    expect(status.graph.topHubs.length).toBe(1);
    expect(status.graph.topHubs[0].title).toBe('Central Hub');
    expect(status.graph.topHubs[0].backlinks).toBe(2);
  });
});
