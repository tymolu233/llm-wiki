import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseMarkdownNote, ParsedNote, Wikilink } from './parser.js';
import { mapWithConcurrency } from './concurrency.js';

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
  // Notes whose lookup names collide case-insensitively (e.g. Note.md vs note.md)
  caseCollisions: { name: string; files: string[] }[];
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
        // Never descend into hidden dirs, dependencies, or immutable raw sources
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'raw') {
          continue;
        }
        const subFiles = await scanMarkdownFiles(fullPath, baseDir);
        results.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (entry.name === 'index.md' || entry.name === 'log.md') {
          continue;
        }
        // Well-known agent instruction files are not wiki notes
        if (entry.name === 'AGENTS.md' || entry.name === 'CLAUDE.md' || entry.name === 'GEMINI.md') {
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
 * Resolves where notes live in a vault: under wiki/ when that directory
 * exists (even if empty), otherwise the vault root (root-layout vault).
 */
export async function resolveVaultNotesRoot(vaultDir: string): Promise<{ notesDir: string; isRootLayout: boolean }> {
  const wikiDir = path.join(vaultDir, 'wiki');
  try {
    if ((await fs.stat(wikiDir)).isDirectory()) {
      return { notesDir: wikiDir, isRootLayout: false };
    }
  } catch {
    // no wiki/ directory
  }
  return { notesDir: vaultDir, isRootLayout: true };
}

/**
 * Builds the bidirectional link graph of the vault.
 */
export async function buildVaultGraph(vaultDir: string): Promise<VaultGraph> {
  const { notesDir } = await resolveVaultNotesRoot(vaultDir);
  const relativeFiles = await scanMarkdownFiles(notesDir, vaultDir);

  const parsedNotes: ParsedNote[] = (
    await mapWithConcurrency(relativeFiles, 32, async (relFile) => {
      try {
        const content = await fs.readFile(path.join(vaultDir, relFile), 'utf-8');
        return parseMarkdownNote(relFile, content);
      } catch {
        return null; // unreadable file — skip rather than fail the whole graph
      }
    })
  ).filter((n): n is ParsedNote => n !== null);

  // Lookup tables
  // Exact match map
  const exactLookup = new Map<string, ParsedNote>();
  // Lowercase match map for case mismatch detection
  const lowerLookup = new Map<string, { note: ParsedNote; canonical: string }>();
  // Track case-insensitive name collisions across distinct notes
  const collisionMap = new Map<string, Set<string>>();

  for (const note of parsedNotes) {
    const basename = path.basename(note.relativePath, '.md');
    const fullRelNoExt = note.relativePath.replace(/\.md$/, '');

    const candidates = [
      basename,
      note.title,
      note.relativePath,
      fullRelNoExt,
      // Obsidian shortest-path form: [[concepts/Foo]]
      fullRelNoExt.replace(/^wiki\//, ''),
      ...note.aliases,
    ];

    for (const name of candidates) {
      exactLookup.set(name, note);
      const lower = name.toLowerCase();
      if (!lowerLookup.has(lower)) {
        lowerLookup.set(lower, { note, canonical: name });
      }
      const owners = collisionMap.get(lower) ?? new Set<string>();
      owners.add(note.relativePath);
      collisionMap.set(lower, owners);
    }
  }

  const caseCollisions = Array.from(collisionMap.entries())
    .filter(([, files]) => files.size > 1)
    .map(([name, files]) => ({ name, files: Array.from(files).sort() }));

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
    caseCollisions,
  };
}
