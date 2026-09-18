import matter from 'gray-matter';
import * as path from 'node:path';

export interface Wikilink {
  raw: string;
  target: string;
  alias?: string;
  anchor?: string;
  line: number;
}

export interface NoteFrontmatter {
  title?: string;
  type?: 'entity' | 'concept' | 'synthesis' | string;
  aliases?: string[];
  tags?: string[];
  sources?: string[];
  last_updated?: string;
  [key: string]: any;
}

export interface ParsedNote {
  relativePath: string;
  title: string;
  type: 'entity' | 'concept' | 'synthesis' | 'unknown';
  aliases: string[];
  tags: string[];
  sources: string[];
  frontmatter: NoteFrontmatter;
  content: string;
  links: Wikilink[];
}

/**
 * Extracts all [[wikilinks]] from markdown content, safely ignoring
 * links inside fenced code blocks, inline code snippets, and HTML comments.
 */
export function extractWikilinks(markdown: string): Wikilink[] {
  // Mask fenced code blocks, inline code, and HTML comments while preserving newlines
  const maskText = (text: string): string => {
    return text
      // HTML comments
      .replace(/<!--[\s\S]*?-->/g, (match) => ' '.repeat(match.length))
      // Fenced code blocks ```...```
      .replace(/```[\s\S]*?```/g, (match) => {
        return match.split('\n').map((line) => ' '.repeat(line.length)).join('\n');
      })
      // Inline code `...`
      .replace(/`[^`\n]+`/g, (match) => ' '.repeat(match.length));
  };

  const masked = maskText(markdown);
  const links: Wikilink[] = [];
  const lines = masked.split('\n');

  const wikilinkRegex = /\[\[([^\]\n]+)\]\]/g;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineText = lines[lineIndex];
    let match: RegExpExecArray | null;

    while ((match = wikilinkRegex.exec(lineText)) !== null) {
      const raw = match[0];
      const inner = match[1].trim();
      if (!inner) continue;

      let targetPart: string;
      let alias: string | undefined;

      const pipeIndex = inner.indexOf('|');
      if (pipeIndex !== -1) {
        targetPart = inner.slice(0, pipeIndex).trim();
        alias = inner.slice(pipeIndex + 1).trim() || undefined;
      } else {
        targetPart = inner;
      }

      let target: string;
      let anchor: string | undefined;

      const hashIndex = targetPart.indexOf('#');
      if (hashIndex !== -1) {
        target = targetPart.slice(0, hashIndex).trim();
        anchor = targetPart.slice(hashIndex + 1).trim() || undefined;
      } else {
        target = targetPart;
      }

      if (target) {
        links.push({
          raw,
          target,
          alias,
          anchor,
          line: lineIndex + 1,
        });
      }
    }
  }

  return links;
}

/**
 * Parses a markdown note file into frontmatter metadata, body content, and outgoing links.
 */
export function parseMarkdownNote(relativePath: string, rawContent: string): ParsedNote {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const basename = path.basename(normalizedPath, path.extname(normalizedPath));

  let frontmatter: NoteFrontmatter = {};
  let content = rawContent;

  try {
    const parsed = matter(rawContent);
    frontmatter = parsed.data || {};
    content = parsed.content;
  } catch {
    // If frontmatter parsing fails, treat entire content as body
    content = rawContent;
  }

  // Infer title from frontmatter, first # H1 header, or basename
  let title = frontmatter.title && typeof frontmatter.title === 'string'
    ? frontmatter.title.trim()
    : '';

  if (!title) {
    const firstH1Match = content.match(/^#\s+([^\r\n]+)/m);
    if (firstH1Match) {
      title = firstH1Match[1].trim();
    } else {
      title = basename;
    }
  }

  // Infer type
  let type: 'entity' | 'concept' | 'synthesis' | 'unknown' = 'unknown';
  if (frontmatter.type === 'entity' || normalizedPath.includes('/entities/')) {
    type = 'entity';
  } else if (frontmatter.type === 'concept' || normalizedPath.includes('/concepts/')) {
    type = 'concept';
  } else if (frontmatter.type === 'synthesis' || normalizedPath.includes('/syntheses/')) {
    type = 'synthesis';
  }

  // Normalize aliases and tags arrays
  const aliases: string[] = Array.isArray(frontmatter.aliases)
    ? frontmatter.aliases.map(String).map((s) => s.trim()).filter(Boolean)
    : [];

  const tags: string[] = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String).map((s) => s.trim()).filter(Boolean)
    : [];

  const sources: string[] = Array.isArray(frontmatter.sources)
    ? frontmatter.sources.map(String).map((s) => s.trim()).filter(Boolean)
    : [];

  const links = extractWikilinks(content);

  return {
    relativePath: normalizedPath,
    title,
    type,
    aliases,
    tags,
    sources,
    frontmatter: {
      ...frontmatter,
      title,
      type,
      aliases,
      tags,
      sources,
    },
    content,
    links,
  };
}
