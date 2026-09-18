import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildVaultGraph, NoteNode } from './graph.js';
import { atomicWriteFile, resolveIndexPath } from './storage.js';
import { INDEX_MARKER_START, INDEX_MARKER_END } from './init.js';

export interface IndexerStats {
  vaultDir: string;
  totalNotes: number;
  conceptCount: number;
  entityCount: number;
  synthesisCount: number;
  updated: boolean;
}

/**
 * Reconciles and rebuilds index.md based on all current notes in the vault,
 * non-destructively preserving any user notes outside the marker comments.
 */
export async function reconcileIndex(vaultDir: string): Promise<IndexerStats> {
  const graph = await buildVaultGraph(vaultDir);
  const indexPath = await resolveIndexPath(vaultDir);

  let existingContent = '';
  try {
    existingContent = await fs.readFile(indexPath, 'utf-8');
  } catch {
    existingContent = `# Wiki Index\n\n${INDEX_MARKER_START}\n${INDEX_MARKER_END}\n`;
  }

  const concepts: NoteNode[] = [];
  const entities: NoteNode[] = [];
  const syntheses: NoteNode[] = [];
  const others: NoteNode[] = [];

  for (const node of graph.notes.values()) {
    switch (node.note.type) {
      case 'concept':
        concepts.push(node);
        break;
      case 'entity':
        entities.push(node);
        break;
      case 'synthesis':
        syntheses.push(node);
        break;
      default:
        others.push(node);
        break;
    }
  }

  // Sort notes alphabetically by title
  const sortFn = (a: NoteNode, b: NoteNode) => a.note.title.localeCompare(b.note.title);
  concepts.sort(sortFn);
  entities.sort(sortFn);
  syntheses.sort(sortFn);
  others.sort(sortFn);

  // Helper to build a table for a category
  const renderCategoryTable = (title: string, nodes: NoteNode[], emptyMessage: string): string => {
    const lines: string[] = [`## ${title}`, ''];

    if (nodes.length === 0) {
      lines.push(emptyMessage, '');
      return lines.join('\n');
    }

    lines.push('| Note | Summary | Backlinks | Updated |');
    lines.push('| :--- | :--- | :---: | :--- |');

    for (const node of nodes) {
      const noteTitle = node.note.title;
      const summary = extractSummary(node);
      const backlinks = node.inboundLinks.length;
      const updated = node.note.frontmatter.last_updated || node.note.frontmatter.date || '-';

      lines.push(`| [[${noteTitle}]] | ${summary} | ${backlinks} | ${updated} |`);
    }

    lines.push('');
    return lines.join('\n');
  };

  const sections: string[] = [];
  sections.push(renderCategoryTable('Concepts', concepts, '_No concepts indexed yet._'));
  sections.push(renderCategoryTable('Entities', entities, '_No entities indexed yet._'));
  sections.push(renderCategoryTable('Syntheses', syntheses, '_No syntheses indexed yet._'));

  if (others.length > 0) {
    sections.push(renderCategoryTable('Other Notes', others, '_No other notes indexed._'));
  }

  const generatedTables = sections.join('\n').trim();

  // Non-destructive replacement between markers
  let newIndexContent = '';
  const startIndex = existingContent.indexOf(INDEX_MARKER_START);
  const endIndex = existingContent.indexOf(INDEX_MARKER_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    const before = existingContent.slice(0, startIndex + INDEX_MARKER_START.length);
    const after = existingContent.slice(endIndex);
    newIndexContent = `${before}\n\n${generatedTables}\n\n${after}`;
  } else {
    // If markers were removed or missing, append them
    newIndexContent = `${existingContent.trim()}\n\n${INDEX_MARKER_START}\n\n${generatedTables}\n\n${INDEX_MARKER_END}\n`;
  }

  const isChanged = newIndexContent !== existingContent;
  if (isChanged) {
    await atomicWriteFile(indexPath, newIndexContent);
  }

  return {
    vaultDir,
    totalNotes: graph.notes.size,
    conceptCount: concepts.length,
    entityCount: entities.length,
    synthesisCount: syntheses.length,
    updated: isChanged,
  };
}

/**
 * Extracts a concise summary from frontmatter or first content line.
 */
function extractSummary(node: NoteNode): string {
  const fm = node.note.frontmatter;
  if (fm.summary && typeof fm.summary === 'string') {
    return escapePipe(fm.summary.trim());
  }
  if (fm.description && typeof fm.description === 'string') {
    return escapePipe(fm.description.trim());
  }

  // Fallback: first non-heading sentence from body
  const lines = node.note.content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```') && !trimmed.startsWith('>')) {
      const clean = trimmed.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');
      const firstSentence = clean.split(/[.!?。！？]/)[0].trim();
      if (firstSentence) {
        return escapePipe(firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence);
      }
    }
  }

  return '_No summary_';
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|');
}
