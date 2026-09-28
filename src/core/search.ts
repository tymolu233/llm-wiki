import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveVaultNotesRoot, scanMarkdownFiles } from './graph.js';
import { mapWithConcurrency } from './concurrency.js';
import { parseMarkdownNote, ParsedNote } from './parser.js';

export interface SearchOptions {
  limit?: number;
  includeRaw?: boolean;
}

export interface SearchResult {
  relativePath: string;
  title: string;
  type: string;
  score: number;
  snippet: string;
  tags: string[];
}

/**
 * Searches the vault notes for keywords or phrases with relevance scoring.
 */
export async function searchVault(
  vaultDir: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) {
    return [];
  }

  const queryTerms = cleanQuery.split(/\s+/).filter(Boolean);
  const limit = Math.max(0, options.limit ?? 10);

  const { notesDir } = await resolveVaultNotesRoot(vaultDir);
  const files = await scanMarkdownFiles(notesDir, vaultDir);

  if (options.includeRaw) {
    const rawDir = path.join(vaultDir, 'raw');
    const rawFiles = await scanMarkdownFiles(rawDir, vaultDir);
    files.push(...rawFiles);
  }

  const results: SearchResult[] = [];

  const notes = await mapWithConcurrency(files, 32, async (relFile) => {
    try {
      const content = await fs.readFile(path.join(vaultDir, relFile), 'utf-8');
      return parseMarkdownNote(relFile, content);
    } catch {
      return null;
    }
  });

  for (const note of notes) {
    if (!note) continue;
    const score = calculateRelevance(note, cleanQuery, queryTerms);

    if (score > 0) {
      const snippet = extractContextSnippet(note.content, queryTerms);
      results.push({
        relativePath: note.relativePath,
        title: note.title,
        type: note.type,
        score,
        snippet,
        tags: note.tags,
      });
    }
  }

  // Sort descending by score, then alphabetically by title (locale-independent)
  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });

  return results.slice(0, limit);
}

function calculateRelevance(note: ParsedNote, fullQuery: string, terms: string[]): number {
  let score = 0;
  const lowerTitle = note.title.toLowerCase();
  const lowerContent = note.content.toLowerCase();
  const lowerAliases = note.aliases.map((a) => a.toLowerCase());
  const lowerTags = note.tags.map((t) => t.toLowerCase());
  const summaryField = note.frontmatter.summary || note.frontmatter.description;
  const summary = typeof summaryField === 'string' ? summaryField.toLowerCase() : '';

  // Exact full query match in title
  if (lowerTitle === fullQuery) {
    score += 100;
  } else if (lowerTitle.includes(fullQuery)) {
    score += 50;
  }

  // Exact alias match
  if (lowerAliases.includes(fullQuery)) {
    score += 80;
  }

  for (const term of terms) {
    if (lowerTitle.includes(term)) {
      score += 30;
    }

    for (const alias of lowerAliases) {
      if (alias.includes(term)) {
        score += 25;
        break;
      }
    }

    if (lowerTags.includes(term)) {
      score += 20;
    }

    if (summary.includes(term)) {
      score += 15;
    }

    // Occurrences in body
    let count = 0;
    let pos = 0;
    while ((pos = lowerContent.indexOf(term, pos)) !== -1) {
      count++;
      pos += term.length;
      if (count >= 10) break; // cap at 10 occurrences
    }
    score += count * 5;
  }

  return score;
}

function extractContextSnippet(content: string, terms: string[]): string {
  const lowerContent = content.toLowerCase();
  let firstIndex = -1;

  for (const term of terms) {
    const idx = lowerContent.indexOf(term);
    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
      firstIndex = idx;
    }
  }

  if (firstIndex === -1) {
    // Fallback: first 120 chars
    const cleaned = content.replace(/[#*`_]/g, '').trim();
    return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
  }

  const start = Math.max(0, firstIndex - 50);
  const end = Math.min(content.length, firstIndex + 90);

  let snippet = content.slice(start, end).replace(/[\r\n]+/g, ' ').replace(/[#*`]/g, '').trim();

  if (start > 0) {
    snippet = `...${snippet}`;
  }
  if (end < content.length) {
    snippet = `${snippet}...`;
  }

  return snippet;
}
