import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildVaultGraph, VaultGraph } from './graph.js';
import pc from 'picocolors';

export interface VaultStatus {
  vaultDir: string;
  notes: {
    total: number;
    concepts: number;
    entities: number;
    syntheses: number;
    others: number;
  };
  sources: {
    totalRaw: number;
    compiledRaw: number;
    pendingRaw: string[];
  };
  graph: {
    totalLinks: number;
    orphanCount: number;
    brokenCount: number;
    topHubs: { title: string; relativePath: string; backlinks: number; type: string }[];
  };
}

/**
 * Recursively scans all non-hidden files inside a directory.
 */
async function scanRawDirectory(dir: string, baseDir: string = dir): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await scanRawDirectory(fullPath, baseDir);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        const relative = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        results.push(relative);
      }
    }
  } catch {
    // Directory might not exist
  }
  return results;
}

/**
 * Computes a comprehensive diagnostic and status overview of the LLM Wiki vault.
 */
export async function getVaultStatus(vaultDir: string): Promise<VaultStatus> {
  const resolvedVault = path.resolve(vaultDir);
  const graph: VaultGraph = await buildVaultGraph(resolvedVault);

  let concepts = 0;
  let entities = 0;
  let syntheses = 0;
  let others = 0;

  const compiledSourceSet = new Set<string>();

  for (const node of graph.notes.values()) {
    switch (node.note.type) {
      case 'concept':
        concepts++;
        break;
      case 'entity':
        entities++;
        break;
      case 'synthesis':
        syntheses++;
        break;
      default:
        others++;
        break;
    }

    // Collect all referenced sources (normalize paths)
    for (const src of node.note.sources) {
      const normalized = src.trim().replace(/\\/g, '/').replace(/^\.\//, '');
      compiledSourceSet.add(normalized);
      // Also record basename for flexible matching
      compiledSourceSet.add(path.basename(normalized));
    }
  }

  // Scan raw sources
  const rawDir = path.join(resolvedVault, 'raw');
  const rawFiles = await scanRawDirectory(rawDir, resolvedVault);

  const pendingRaw: string[] = [];
  let compiledCount = 0;

  for (const relRaw of rawFiles) {
    const normalizedRel = relRaw.replace(/\\/g, '/');
    const basename = path.basename(normalizedRel);
    if (compiledSourceSet.has(normalizedRel) || compiledSourceSet.has(basename)) {
      compiledCount++;
    } else {
      pendingRaw.push(normalizedRel);
    }
  }

  // Calculate Hubs (nodes with most backlinks)
  const allNodes = Array.from(graph.notes.values());
  allNodes.sort((a, b) => b.inboundLinks.length - a.inboundLinks.length);

  const topHubs = allNodes
    .filter((n) => n.inboundLinks.length > 0)
    .slice(0, 5)
    .map((n) => ({
      title: n.note.title,
      relativePath: n.note.relativePath,
      backlinks: n.inboundLinks.length,
      type: n.note.type,
    }));

  let brokenCount = 0;
  for (const link of graph.allResolvedLinks) {
    if (!link.isResolved) {
      brokenCount++;
    }
  }

  let orphanCount = 0;
  for (const node of graph.notes.values()) {
    if (node.inboundLinks.length === 0) {
      orphanCount++;
    }
  }

  return {
    vaultDir: resolvedVault,
    notes: {
      total: graph.notes.size,
      concepts,
      entities,
      syntheses,
      others,
    },
    sources: {
      totalRaw: rawFiles.length,
      compiledRaw: compiledCount,
      pendingRaw,
    },
    graph: {
      totalLinks: graph.allResolvedLinks.length,
      orphanCount,
      brokenCount,
      topHubs,
    },
  };
}

/**
 * Formats a human-readable terminal status dashboard.
 */
export function formatVaultStatus(status: VaultStatus): string {
  const lines: string[] = [];
  lines.push(`\n${pc.bold('LLM Wiki Vault Status')}: ${pc.cyan(status.vaultDir)}\n`);

  // Notes
  lines.push(pc.bold('Knowledge Base Notes:'));
  lines.push(`   - Total Notes:     ${pc.bold(status.notes.total.toString())}`);
  lines.push(`     * Concepts:      ${pc.green(status.notes.concepts.toString())}`);
  lines.push(`     * Entities:      ${pc.blue(status.notes.entities.toString())}`);
  lines.push(`     * Syntheses:     ${pc.magenta(status.notes.syntheses.toString())}`);
  if (status.notes.others > 0) {
    lines.push(`     * Other:         ${status.notes.others}`);
  }
  lines.push('');

  // Raw Sources & Compilation Progress
  lines.push(pc.bold('Source Material (raw/):'));
  lines.push(`   - Total Raw:       ${status.sources.totalRaw}`);
  lines.push(`   - Compiled:        ${pc.green(status.sources.compiledRaw.toString())}`);
  if (status.sources.pendingRaw.length > 0) {
    lines.push(`   - ${pc.yellow('Pending Compilation:')} ${pc.yellow(pc.bold(status.sources.pendingRaw.length.toString()))}`);
    for (const pending of status.sources.pendingRaw) {
      lines.push(`     ${pc.yellow('⏳')} ${pc.dim(pending)}`);
    }
    lines.push(`     ${pc.dim('-> Tip: Instruct your agent to compile these raw sources into atomic notes.')}`);
  } else {
    lines.push(`   - Pending:         ${pc.green('0 (All sources compiled)')}`);
  }
  lines.push('');

  // Graph Topology & Hubs
  lines.push(pc.bold('Graph Topology:'));
  lines.push(`   - Total Wikilinks: ${status.graph.totalLinks}`);
  lines.push(`   - Broken Links:    ${status.graph.brokenCount === 0 ? pc.green('0') : pc.red(status.graph.brokenCount.toString())}`);
  lines.push(`   - Orphan Notes:    ${status.graph.orphanCount === 0 ? pc.green('0') : pc.yellow(status.graph.orphanCount.toString())}`);

  if (status.graph.topHubs.length > 0) {
    lines.push('');
    lines.push(pc.bold('Central Knowledge Hubs:'));
    for (const hub of status.graph.topHubs) {
      lines.push(`   - [[${pc.bold(hub.title)}]] ${pc.dim(`(${hub.backlinks} backlinks, ${hub.type})`)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
