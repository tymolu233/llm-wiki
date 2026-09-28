import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildVaultGraph, resolveVaultNotesRoot, scanMarkdownFiles } from '../src/core/graph.js';
import { lintVault } from '../src/core/linter.js';
import { mapWithConcurrency } from '../src/core/concurrency.js';

describe('Vault Graph Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-graph-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('treats an existing but empty wiki/ as an empty vault, ignoring root decoys', async () => {
    await fs.mkdir(path.join(tempDir, 'wiki'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Readme\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg', 'README.md'), '# Pkg\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, '.hidden'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.hidden', 'note.md'), '# Hidden\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, 'raw'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'raw', 'source.md'), '# Source\n', 'utf-8');

    const { notesDir, isRootLayout } = await resolveVaultNotesRoot(tempDir);
    expect(notesDir).toBe(path.join(tempDir, 'wiki'));
    expect(isRootLayout).toBe(false);

    const graph = await buildVaultGraph(tempDir);
    expect(graph.notes.size).toBe(0);
    expect(graph.allResolvedLinks).toHaveLength(0);

    const report = await lintVault(tempDir);
    expect(report.stats.noteCount).toBe(0);
    expect(report.issues).toHaveLength(0);
  });

  it('scans the vault root when wiki/ does not exist (root layout)', async () => {
    await fs.writeFile(path.join(tempDir, 'index.md'), '# Root Index\n', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'Alpha.md'), '# Alpha\nLinks to [[Beta]].\n', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'Beta.md'), '# Beta\nLinks to [[Alpha]].\n', 'utf-8');

    const { notesDir, isRootLayout } = await resolveVaultNotesRoot(tempDir);
    expect(notesDir).toBe(tempDir);
    expect(isRootLayout).toBe(true);

    const graph = await buildVaultGraph(tempDir);
    expect(graph.notes.size).toBe(2);
    const broken = graph.allResolvedLinks.filter((l) => !l.isResolved);
    expect(broken).toHaveLength(0);
  });

  it('skips hidden dirs, node_modules, and raw/ during scans but still scans an explicit root', async () => {
    await fs.mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'node_modules', 'pkg', 'README.md'), '# Pkg\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, '.hidden'));
    await fs.writeFile(path.join(tempDir, '.hidden', 'ignored.md'), '# Ignored\n', 'utf-8');
    await fs.mkdir(path.join(tempDir, 'raw'));
    await fs.writeFile(path.join(tempDir, 'raw', 'source.md'), '# Source\n', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'Note.md'), '# Note\n', 'utf-8');

    const files = await scanMarkdownFiles(tempDir, tempDir);
    expect(files).toEqual(['Note.md']);

    // The scan root itself is never filtered, so explicit raw/ scans still work
    const rawFiles = await scanMarkdownFiles(path.join(tempDir, 'raw'), tempDir);
    expect(rawFiles).toEqual(['raw/source.md']);
  });

  it('resolves Obsidian shortest-path links like [[concepts/Foo]]', async () => {
    await fs.mkdir(path.join(tempDir, 'wiki', 'concepts'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'wiki', 'concepts', 'Foo.md'), '# Foo\nStub.\n', 'utf-8');
    await fs.writeFile(path.join(tempDir, 'wiki', 'concepts', 'Bar.md'), '# Bar\nSee [[concepts/Foo]].\n', 'utf-8');

    const graph = await buildVaultGraph(tempDir);
    const link = graph.allResolvedLinks.find((l) => l.link.target === 'concepts/Foo');
    expect(link?.isResolved).toBe(true);
    expect(link?.isCaseMismatch).toBe(false);
    expect(link?.targetNote?.relativePath).toBe('wiki/concepts/Foo.md');
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order, processes every item, and caps in-flight work', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await mapWithConcurrency(items, 8, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, (n % 3) + 1));
      inFlight--;
      return n * 2;
    });

    expect(results).toEqual(items.map((n) => n * 2));
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it('handles empty input', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });
});
