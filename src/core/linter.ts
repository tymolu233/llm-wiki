import { buildVaultGraph, VaultGraph } from './graph.js';

export interface LintIssue {
  type: 'broken-link' | 'orphan-note' | 'case-mismatch';
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
  };
}

/**
 * Audits the vault for broken links, orphan notes, and case-sensitivity mismatches.
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

  return {
    vaultDir,
    issues,
    stats: {
      noteCount: graph.notes.size,
      linkCount,
      orphanCount,
      brokenCount,
      caseMismatchCount,
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
