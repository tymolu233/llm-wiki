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

const realBaseDirCache = new Map<string, Promise<string>>();

/**
 * Resolves the real (canonical, symlink-free) path of `baseDir`.
 * Results are cached per resolved base directory string.
 */
function realpathBaseDir(resolvedBase: string): Promise<string> {
  let cached = realBaseDirCache.get(resolvedBase);
  if (!cached) {
    cached = fs.realpath(resolvedBase);
    cached.catch(() => realBaseDirCache.delete(resolvedBase));
    realBaseDirCache.set(resolvedBase, cached);
  }
  return cached;
}

/**
 * Finds the nearest existing ancestor of `targetPath` (the path itself if it
 * exists, otherwise a parent directory) along with the non-existent suffix
 * below it.
 */
async function findExistingAncestor(targetPath: string): Promise<{ existing: string; suffix: string }> {
  let current = targetPath;
  let suffix = '';
  while (true) {
    try {
      await fs.lstat(current);
      return { existing: current, suffix };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return { existing: current, suffix };
      }
      suffix = suffix ? path.join(path.basename(current), suffix) : path.basename(current);
      current = parent;
    }
  }
}

/**
 * Like `assertPathContained`, but additionally follows symlinks/junctions:
 * the real path of the nearest existing ancestor of the target must keep the
 * target inside the real base directory. Prevents vault writes from escaping
 * through a symlinked vault subdirectory. Returns the ORIGINAL resolved
 * absolute target so callers keep their current paths.
 */
export async function assertPathContainedReal(baseDir: string, targetPath: string): Promise<string> {
  const resolvedTarget = assertPathContained(baseDir, targetPath);
  const realBase = await realpathBaseDir(path.resolve(baseDir));

  // Follow links through the nearest existing ancestor, then re-attach the
  // suffix that does not exist yet (the destination of the future write).
  const { existing, suffix } = await findExistingAncestor(resolvedTarget);
  const realAncestor = await fs.realpath(existing);
  const realTarget = suffix ? path.join(realAncestor, suffix) : realAncestor;

  // Verify the real target is still inside the real base (Windows compares
  // case-insensitively).
  const baseForCompare = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
  const targetForCompare = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget;
  const relative = path.relative(baseForCompare, targetForCompare);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path traversal detected: "${targetPath}" escapes base directory "${baseDir}"`);
  }

  return resolvedTarget;
}

/**
 * Atomically writes `content` to `relativePath` within `baseDir`, verifying
 * both string-level and symlink-aware containment first.
 */
export async function safeWriteFileWithin(baseDir: string, relativePath: string, content: string): Promise<void> {
  const targetPath = await assertPathContainedReal(baseDir, relativePath);
  await atomicWriteFile(targetPath, content);
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

const vaultWriteQueues = new Map<string, Promise<void>>();

/**
 * Serializes asynchronous vault write operations per key (typically a vault
 * directory) by chaining them on a per-key promise queue. Concurrent calls
 * run one after another in invocation order, preventing interleaved
 * read-modify-write cycles from losing updates.
 */
export function enqueueVaultWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = vaultWriteQueues.get(key) ?? Promise.resolve();
  const next = previous.then(fn);
  const tail = next.then(
    () => undefined,
    () => undefined
  );
  vaultWriteQueues.set(key, tail);
  void tail.then(() => {
    if (vaultWriteQueues.get(key) === tail) {
      vaultWriteQueues.delete(key);
    }
  });
  return next;
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
