import * as fs from 'node:fs';

/**
 * Reads the package version from package.json at the package root.
 * Resolves relative to this module so it works from both src/core/ and
 * dist/core/ (two levels below the root), regardless of the importer.
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}
