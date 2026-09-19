import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { assertPathContained, atomicWriteFile, safeReadFile, findVaultRoot } from '../src/core/storage.js';

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
});

function content(str: string): string {
  return str;
}
