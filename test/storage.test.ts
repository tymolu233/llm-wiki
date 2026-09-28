import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { assertPathContained, assertPathContainedReal, safeWriteFileWithin, atomicWriteFile, safeReadFile, findVaultRoot, enqueueVaultWrite } from '../src/core/storage.js';

describe('Storage Module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-storage-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('assertPathContained', () => {
    it('allows valid paths inside the base directory', () => {
      const validPath = path.join(tempDir, 'wiki', 'entities', 'test.md');
      expect(() => assertPathContained(tempDir, validPath)).not.toThrow();
    });

    it('rejects paths attempting directory traversal with ..', () => {
      const escapePath = path.join(tempDir, '..', 'evil.md');
      expect(() => assertPathContained(tempDir, escapePath)).toThrow(/Path traversal detected/);
    });

    it('rejects relative traversal attempts', () => {
      expect(() => assertPathContained(tempDir, '../../etc/passwd')).toThrow(/Path traversal detected/);
    });
  });

  describe('atomicWriteFile', () => {
    it('creates parent directories and writes content safely', async () => {
      const targetFile = path.join(tempDir, 'nested', 'dir', 'note.md');
      const content = '# Hello World\nTesting atomic write.';

      await atomicWriteFile(targetFile, content);

      const readBack = await fs.readFile(targetFile, 'utf-8');
      expect(readBack).toBe(content);
    });

    it('overwrites existing files cleanly without leaving temp files', async () => {
      const targetFile = path.join(tempDir, 'note.md');
      await atomicWriteFile(targetFile, 'initial content');
      await atomicWriteFile(targetFile, 'updated content');

      const readBack = await fs.readFile(targetFile, 'utf-8');
      expect(readBack).toBe(content('updated content'));

      const dirFiles = await fs.readdir(tempDir);
      expect(dirFiles).toEqual(['note.md']);
    });
  });

  describe('safeReadFile', () => {
    it('reads files within the vault safely', async () => {
      const targetFile = path.join(tempDir, 'doc.txt');
      await fs.writeFile(targetFile, 'safe content', 'utf-8');

      const content = await safeReadFile(tempDir, 'doc.txt');
      expect(content).toBe('safe content');
    });

    it('blocks reading files outside the vault', async () => {
      await expect(safeReadFile(tempDir, '../outside.txt')).rejects.toThrow(/Path traversal detected/);
    });
  });

  describe('findVaultRoot', () => {
    it('returns the same directory if wiki/ exists directly in it', async () => {
      await fs.mkdir(path.join(tempDir, 'wiki'));
      const root = await findVaultRoot(tempDir);
      expect(root).toBe(path.resolve(tempDir));
    });

    it('resolves the vault root when called from a deep subdirectory', async () => {
      await fs.mkdir(path.join(tempDir, 'wiki'));
      const nestedSubdir = path.join(tempDir, 'subfolder', 'deep', 'nested');
      await fs.mkdir(nestedSubdir, { recursive: true });

      const root = await findVaultRoot(nestedSubdir);
      expect(root).toBe(path.resolve(tempDir));
    });

    it('resolves vault root based on root index.md if wiki/ is not present', async () => {
      await fs.writeFile(path.join(tempDir, 'index.md'), '# Wiki Index');
      const nestedSubdir = path.join(tempDir, 'src', 'components');
      await fs.mkdir(nestedSubdir, { recursive: true });

      const root = await findVaultRoot(nestedSubdir);
      expect(root).toBe(path.resolve(tempDir));
    });
  });

  describe('assertPathContainedReal + safeWriteFileWithin', () => {
    it('rejects writes escaping the vault through a symlinked vault subdirectory', async (t) => {
      // A directory OUTSIDE the vault with a marker file; the vault's `wiki`
      // subdirectory is a link pointing at it, so a string-level containment
      // check alone would let writes escape the vault.
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-outside-'));
      await fs.writeFile(path.join(outsideDir, 'marker.txt'), 'outside');

      const vaultDir = path.join(tempDir, 'vault');
      await fs.mkdir(vaultDir, { recursive: true });

      let linkCreated = true;
      try {
        // Junctions need no admin on Windows; 'dir' symlinks on POSIX.
        await fs.symlink(outsideDir, path.join(vaultDir, 'wiki'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EACCES') {
          await fs.rm(outsideDir, { recursive: true, force: true });
          throw error;
        }
        linkCreated = false;
      }
      if (!linkCreated) {
        await fs.rm(outsideDir, { recursive: true, force: true });
        // Environment cannot create symlinks; nothing to harden against here.
        t.skip();
      }

      try {
        await expect(
          safeWriteFileWithin(vaultDir, path.join('wiki', 'concepts', 'X.md'), '# Escaped')
        ).rejects.toThrow(/Path traversal detected/);

        // The outside directory gained no file
        const outsideFiles = await fs.readdir(outsideDir);
        expect(outsideFiles).toEqual(['marker.txt']);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('resolves benign paths inside the vault', async () => {
      const vaultDir = path.join(tempDir, 'vault');
      await fs.mkdir(path.join(vaultDir, 'wiki', 'concepts'), { recursive: true });

      const resolved = await assertPathContainedReal(vaultDir, path.join('wiki', 'concepts', 'X.md'));
      expect(resolved).toBe(path.resolve(vaultDir, 'wiki', 'concepts', 'X.md'));

      await safeWriteFileWithin(vaultDir, path.join('wiki', 'concepts', 'X.md'), '# Fine');
      await expect(fs.readFile(path.join(vaultDir, 'wiki', 'concepts', 'X.md'), 'utf-8')).resolves.toBe('# Fine');
    });

    it('still rejects ../ traversal from the string-level check', async () => {
      await expect(assertPathContainedReal(tempDir, '../outside.md')).rejects.toThrow(/Path traversal detected/);
      await expect(safeWriteFileWithin(tempDir, '../outside.md', 'nope')).rejects.toThrow(/Path traversal detected/);
    });
  });

  describe('enqueueVaultWrite', () => {
    it('serializes concurrent operations per key without interleaving', async () => {
      const events: string[] = [];
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          enqueueVaultWrite(tempDir, async () => {
            events.push(`start-${i}`);
            await new Promise((r) => setTimeout(r, 1));
            events.push(`end-${i}`);
          })
        )
      );

      expect(events).toHaveLength(40);
      // Each start must be immediately followed by its matching end
      for (let k = 0; k < 20; k++) {
        const id = events[2 * k].replace('start-', '');
        expect(events[2 * k + 1]).toBe(`end-${id}`);
      }
    });

    it('propagates results and keeps the queue alive after errors', async () => {
      const first = enqueueVaultWrite(tempDir, async () => 42);
      const failing = enqueueVaultWrite(tempDir, async () => {
        throw new Error('boom');
      });
      const after = enqueueVaultWrite(tempDir, async () => 'recovered');

      await expect(first).resolves.toBe(42);
      await expect(failing).rejects.toThrow('boom');
      await expect(after).resolves.toBe('recovered');
    });
  });
});

function content(str: string): string {
  return str;
}
