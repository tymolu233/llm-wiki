import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildVaultGraph, VaultGraph } from './graph.js';
import { extractWikilinks } from './parser.js';
import { resolveIndexPath } from './storage.js';
import { INDEX_MARKER_START, INDEX_MARKER_END } from './init.js';

export interface LintIssue {
  type: 'broken-link' | 'orphan-note' | 'case-mismatch' | 'case-collision' | 'untracked-note' | 'missing-index';
  severity: 'error' | 'warning';
  file: string;
  line?: number;
  message: string;
  target?: string;
  expected?: string;
  rawLink?: string;
}

export interface LintReport {
  vaultDir: string;
  issues: LintIssue[];
  stats: {
    noteCount: number;
    linkCount: number;
    orphanCount: number;
    brokenCount: number;
    caseMismatchCount: number;
    caseCollisionCount: number;
  };
}

/**
 * Audits the vault for broken links, orphan notes, case-sensitivity mismatches,
 * and untracked notes missing from index.md.
 */
export async function lintVault(vaultDir: string): Promise<LintReport> {
  const graph: VaultGraph = await buildVaultGraph(vaultDir);
  const issues: LintIssue[] = [];

  let linkCount = 0;
  let brokenCount = 0;
  let orphanCount = 0;
  let caseMismatchCount = 0;

  // 1. Audit links
  for (const resolved of graph.allResolvedLinks) {
    linkCount++;

    if (!resolved.isResolved) {
      brokenCount++;
      issues.push({
        type: 'broken-link',
        severity: 'error',
        file: resolved.sourceNote.relativePath,
        line: resolved.link.line,
        rawLink: resolved.link.raw,
        target: resolved.link.target,
        message: `Broken link: "${resolved.link.raw}" targets non-existent note "${resolved.link.target}"`,
      });
    } else if (resolved.isCaseMismatch) {
      caseMismatchCount++;
      issues.push({
        type: 'case-mismatch',
        severity: 'warning',
        file: resolved.sourceNote.relativePath,
        line: resolved.link.line,
        rawLink: resolved.link.raw,
        target: resolved.link.target,
        expected: resolved.expectedName,
        message: `Case mismatch: "${resolved.link.raw}" matches "${resolved.expectedName}" case-insensitively. This will fail on Linux/GitHub.`,
      });
    }
  }

  // 2. Audit orphan notes (only if there are notes in vault)
  // If there is only 1 note in the entire vault, don't necessarily flag it if it's new, but general rule: 0 inbound links
  for (const [relPath, node] of graph.notes.entries()) {
    if (node.inboundLinks.length === 0) {
      orphanCount++;
      issues.push({
        type: 'orphan-note',
        severity: 'warning',
        file: relPath,
        message: `Orphan note: "${node.note.title}" has 0 inbound links from other notes.`,
      });
    }
  }

  // 3. Audit case-insensitive name collisions (ambiguous link resolution, breaks on case-sensitive filesystems)
  for (const collision of graph.caseCollisions) {
    issues.push({
      type: 'case-collision',
      severity: 'error',
      file: collision.files[0],
      message: `Case collision: "${collision.name}" is claimed by multiple notes: ${collision.files.join(', ')}. Link resolution is ambiguous.`,
    });
  }

  // 4. Audit untracked notes (present on disk but omitted from index.md)
  let indexContent: string | null = null;
  try {
    const indexPath = await resolveIndexPath(vaultDir);
    indexContent = await fs.readFile(indexPath, 'utf-8');
  } catch {
    // Missing or unreadable index — one warning instead of per-note spam.
    // An empty vault has nothing to track, so it stays healthy.
    if (graph.notes.size > 0) {
      issues.push({
        type: 'missing-index',
        severity: 'warning',
        file: 'index.md',
        message: 'index.md is missing — run npx @tymolu/llmwiki index to generate it',
      });
    }
  }

  if (indexContent !== null) {
    // Generated tables live between the LLMWIKI markers; custom user content
    // outside them does not count as tracking. Without markers, scan everything.
    const markerStart = indexContent.indexOf(INDEX_MARKER_START);
    const markerEnd = indexContent.indexOf(INDEX_MARKER_END);
    const region =
      markerStart !== -1 && markerEnd !== -1 && markerEnd > markerStart
        ? indexContent.slice(markerStart + INDEX_MARKER_START.length, markerEnd)
        : indexContent;

    const tracked = new Set<string>();
    for (const link of extractWikilinks(region)) {
      const target = link.target.trim().toLowerCase();
      if (target) {
        tracked.add(target);
        if (target.endsWith('.md')) {
          tracked.add(target.slice(0, -3));
        }
      }
    }

    for (const [relPath, node] of graph.notes.entries()) {
      const withoutExt = relPath.replace(/\.md$/, '');
      const candidates = [node.note.title, path.basename(relPath, '.md'), withoutExt, withoutExt.replace(/^wiki\//, '')];
      const isTracked = candidates.some((candidate) => tracked.has(candidate.toLowerCase()));
      if (!isTracked) {
        issues.push({
          type: 'untracked-note',
          severity: 'warning',
          file: relPath,
          message: `Untracked note: "${node.note.title}" (${relPath}) is missing from index.md — run npx @tymolu/llmwiki index to refresh`,
        });
      }
    }
  }

  return {
    vaultDir,
    issues,
    stats: {
      noteCount: graph.notes.size,
      linkCount,
      orphanCount,
      brokenCount,
      caseMismatchCount,
      caseCollisionCount: graph.caseCollisions.length,
    },
  };
}

/**
 * Pretty-formats a lint report for terminal output.
 */
export function formatLintReport(report: LintReport): string {
  const lines: string[] = [];
  lines.push(`\nLLM Wiki Health Check for: ${report.vaultDir}\n`);

  if (report.issues.length === 0) {
    lines.push(`Vault is completely healthy!`);
    lines.push(`   - Total notes:     ${report.stats.noteCount}`);
    lines.push(`   - Verified links:  ${report.stats.linkCount}\n`);
    return lines.join('\n');
  }

  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    lines.push(`Errors (${errors.length}):`);
    for (const err of errors) {
      const lineInfo = err.line ? `:${err.line}` : '';
      lines.push(`  - [${err.file}${lineInfo}] ${err.message}`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const warn of warnings) {
      const lineInfo = warn.line ? `:${warn.line}` : '';
      lines.push(`  - [${warn.file}${lineInfo}] ${warn.message}`);
    }
    lines.push('');
  }

  lines.push(`Summary: ${report.stats.noteCount} notes, ${report.stats.linkCount} links, ${errors.length} errors, ${warnings.length} warnings\n`);
  return lines.join('\n');
}
