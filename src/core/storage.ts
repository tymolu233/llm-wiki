import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Validates that `targetPath` resolves strictly inside `baseDir`.
 * Prevents directory traversal attacks (CVE-style path escape).
 */
export function assertPathContained(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);

  // Check prefix containment
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path traversal detected: "${targetPath}" escapes base directory "${baseDir}"`);
  }

  return resolvedTarget;
}

/**
 * Atomically writes content to `filePath` by writing to a temporary file
 * in the same directory and renaming it, preventing corrupt/half-written files.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tempPath = `${filePath}.${randomSuffix}.tmp`;

  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore unlink failure if temp file wasn't created
    }
    throw error;
  }
}

/**
 * Safely reads a file within a base directory, verifying path containment first.
 */
export async function safeReadFile(baseDir: string, relativePath: string): Promise<string> {
  const targetPath = assertPathContained(baseDir, relativePath);
  return await fs.readFile(targetPath, 'utf-8');
}

/**
 * Resolves the location of a vault file (index.md / log.md), checking
 * wiki/<name> first, then falling back to the vault root.
 * Defaults to wiki/<name> for a clean project root.
 */
async function resolveVaultFile(vaultDir: string, name: string): Promise<string> {
  const wikiPath = path.join(vaultDir, 'wiki', name);
  try {
    await fs.access(wikiPath);
    return wikiPath;
  } catch {
    const rootPath = path.join(vaultDir, name);
    try {
      await fs.access(rootPath);
      return rootPath;
    } catch {
      return wikiPath;
    }
  }
}

export function resolveIndexPath(vaultDir: string): Promise<string> {
  return resolveVaultFile(vaultDir, 'index.md');
}

export function resolveLogPath(vaultDir: string): Promise<string> {
  return resolveVaultFile(vaultDir, 'log.md');
}

/**
 * Resolves the root of the LLM Wiki vault by walking up the directory tree
 * from `startDir` until finding markers like `wiki/` directory or `index.md`.
 * If none found, returns the resolved `startDir`.
 */
export async function findVaultRoot(startDir: string): Promise<string> {
  let current = path.resolve(startDir);
  while (true) {
    const wikiDir = path.join(current, 'wiki');
    try {
      const stat = await fs.stat(wikiDir);
      if (stat.isDirectory()) {
        return current;
      }
    } catch {}

    const indexFile = path.join(current, 'index.md');
    try {
      const stat = await fs.stat(indexFile);
      if (stat.isFile()) {
        return current;
      }
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir);
}
