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
