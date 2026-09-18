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
  });
});
