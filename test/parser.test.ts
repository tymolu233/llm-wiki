import { describe, it, expect } from 'vitest';
import { extractWikilinks, parseMarkdownNote } from '../src/core/parser.js';

describe('Parser Module', () => {
  it('extracts standard [[Note]] wikilinks with line numbers', () => {
    const markdown = `# Title
Here is a link to [[Distributed Consensus]] and another to [[Raft]].
`;
    const links = extractWikilinks(markdown);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      target: 'Distributed Consensus',
      raw: '[[Distributed Consensus]]',
      line: 2,
    });
    expect(links[1]).toMatchObject({
      target: 'Raft',
      raw: '[[Raft]]',
      line: 2,
    });
  });

  it('handles aliases [[Target|Display Text]] and anchors [[Target#Heading]]', () => {
    const markdown = `Check [[Paxos|The Paxos Algorithm]] and [[LLM#Architecture|Model Architecture]].`;
    const links = extractWikilinks(markdown);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      target: 'Paxos',
      alias: 'The Paxos Algorithm',
    });
    expect(links[1]).toMatchObject({
      target: 'LLM',
      anchor: 'Architecture',
      alias: 'Model Architecture',
    });
  });

  it('ignores wikilinks inside fenced code blocks and inline code', () => {
    const markdown = `
Real link: [[Real Note]]

\`\`\`javascript
const code = "[[Fake Code Link]]";
\`\`\`

Here is \`[[Inline Code Link]]\` too.

<!-- [[Comment Link]] -->
`;
    const links = extractWikilinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe('Real Note');
  });

  it('parses frontmatter and note content with metadata', () => {
    const raw = `---
title: "Attention Mechanism"
type: concept
aliases: ["Self-Attention", "Transformer Attention"]
tags: ["ai", "deep-learning"]
sources: ["raw/transformer.pdf"]
last_updated: "2026-04-02"
---

The attention mechanism was introduced by [[Vaswani et al]].
`;
    const note = parseMarkdownNote('wiki/concepts/attention.md', raw);
    expect(note.title).toBe('Attention Mechanism');
    expect(note.type).toBe('concept');
    expect(note.aliases).toEqual(['Self-Attention', 'Transformer Attention']);
    expect(note.tags).toEqual(['ai', 'deep-learning']);
    expect(note.sources).toEqual(['raw/transformer.pdf']);
    expect(note.links).toHaveLength(1);
    expect(note.links[0].target).toBe('Vaswani et al');
    // Frontmatter block spans lines 1-8; the link is on file line 10
    expect(note.links[0].line).toBe(10);
  });

  it('ignores Obsidian image embeds ![[file.png]]', () => {
    const markdown = `# Note
![[diagram.png]]
See [[Other Note]] for details.`;
    const links = extractWikilinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ target: 'Other Note', line: 3 });
  });

  it('preserves line numbers across multi-line HTML comments', () => {
    const markdown = `# Title
<!--
comment
-->
[[Broken Link]]`;
    const links = extractWikilinks(markdown);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ target: 'Broken Link', line: 5 });
  });

  it('honors the lineOffset option', () => {
    const links = extractWikilinks('Body line one\nBody line two with [[Note]]', { lineOffset: 10 });
    expect(links).toHaveLength(1);
    expect(links[0].line).toBe(12);
  });

  it('reports file line numbers for links after a frontmatter block', () => {
    const raw = '---\ntitle: "Meta"\ntype: concept\n---\nFirst body line with [[Missing]].\n';
    const note = parseMarkdownNote('wiki/concepts/meta.md', raw);
    expect(note.links).toHaveLength(1);
    expect(note.links[0].line).toBe(5);
  });

  it('falls back to unshifted line numbers when frontmatter parsing fails', () => {
    const raw = '---\ntitle: [unclosed\n---\nLink on line 4: [[Missing]]\n';
    const note = parseMarkdownNote('wiki/concepts/broken.md', raw);
    expect(note.links).toHaveLength(1);
    expect(note.links[0].line).toBe(4);
  });
});
