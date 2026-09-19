import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdownNote, ParsedNote, Wikilink } from './parser.js';

export interface ResolvedLink {
  link: Wikilink;
  sourceNote: ParsedNote;
  targetNote?: ParsedNote;
  isResolved: boolean;
  isCaseMismatch?: boolean;
  expectedName?: string;
}

export interface NoteNode {
  note: ParsedNote;
  outboundLinks: ResolvedLink[];
  inboundLinks: { fromFile: string; fromTitle: string; link: Wikilink }[];
}

export interface VaultGraph {
  notes: Map<string, NoteNode>; // keyed by normalized relative path
  allResolvedLinks: ResolvedLink[];
}

/**
 * Recursively retrieves all markdown files within a directory.
 */
export async function scanMarkdownFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await scanMarkdownFiles(fullPath, baseDir);
        results.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name === 'index.md' || entry.name === 'log.md') {
          continue;
        }
        const relative = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        results.push(relative);
      }
    }
  } catch {
    // Directory might not exist yet
  }

  return results;
}

/**
 * Builds the bidirectional link graph of the vault.
 */
export async function buildVaultGraph(vaultDir: string): Promise<VaultGraph> {
  const wikiDir = path.join(vaultDir, 'wiki');
  const relativeFiles = await scanMarkdownFiles(wikiDir, vaultDir);

  const parsedNotes: ParsedNote[] = [];

  for (const relFile of relativeFiles) {
    const fullPath = path.join(vaultDir, relFile);
    const content = await fs.readFile(fullPath, 'utf-8');
    parsedNotes.push(parseMarkdownNote(relFile, content));
  }

  // Lookup tables
  // Exact match map
  const exactLookup = new Map<string, ParsedNote>();
  // Lowercase match map for case mismatch detection
  const lowerLookup = new Map<string, { note: ParsedNote; canonical: string }>();

  for (const note of parsedNotes) {
    const basename = path.basename(note.relativePath, '.md');
    const fullRelNoExt = note.relativePath.replace(/\.md$/, '');

    const candidates = [
      basename,
      note.title,
      note.relativePath,
      fullRelNoExt,
      ...note.aliases,
    ];

    for (const name of candidates) {
      exactLookup.set(name, note);
      if (!lowerLookup.has(name.toLowerCase())) {
        lowerLookup.set(name.toLowerCase(), { note, canonical: name });
      }
    }
  }

  const nodes = new Map<string, NoteNode>();
  for (const note of parsedNotes) {
    nodes.set(note.relativePath, {
      note,
      outboundLinks: [],
      inboundLinks: [],
    });
  }

  const allResolvedLinks: ResolvedLink[] = [];

  for (const note of parsedNotes) {
    const node = nodes.get(note.relativePath)!;

    for (const link of note.links) {
      const cleanTarget = link.target.trim().replace(/\.md$/, '');
      const exactMatch = exactLookup.get(cleanTarget) || exactLookup.get(link.target.trim());

      if (exactMatch) {
        const resolved: ResolvedLink = {
          link,
          sourceNote: note,
          targetNote: exactMatch,
          isResolved: true,
          isCaseMismatch: false,
        };
        node.outboundLinks.push(resolved);
        allResolvedLinks.push(resolved);

        const targetNode = nodes.get(exactMatch.relativePath);
        if (targetNode) {
          targetNode.inboundLinks.push({
            fromFile: note.relativePath,
            fromTitle: note.title,
            link,
          });
        }
      } else {
        const lowerMatch = lowerLookup.get(cleanTarget.toLowerCase()) || lowerLookup.get(link.target.trim().toLowerCase());

        if (lowerMatch) {
          // Case mismatch
          const resolved: ResolvedLink = {
            link,
            sourceNote: note,
            targetNote: lowerMatch.note,
            isResolved: true,
            isCaseMismatch: true,
            expectedName: lowerMatch.canonical,
          };
          node.outboundLinks.push(resolved);
          allResolvedLinks.push(resolved);

          const targetNode = nodes.get(lowerMatch.note.relativePath);
          if (targetNode) {
            targetNode.inboundLinks.push({
              fromFile: note.relativePath,
              fromTitle: note.title,
              link,
            });
          }
        } else {
          // Broken link
          const unresolved: ResolvedLink = {
            link,
            sourceNote: note,
            isResolved: false,
          };
          node.outboundLinks.push(unresolved);
          allResolvedLinks.push(unresolved);
        }
      }
    }
  }

  return {
    notes: nodes,
    allResolvedLinks,
  };
}
