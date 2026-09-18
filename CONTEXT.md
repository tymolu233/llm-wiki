# LLM Wiki

A persistent, compounding personal knowledge base compiled and maintained by LLMs, stored as standard Markdown and viewable in Obsidian, VS Code, or any markdown viewer.

## Language

### Core Entities

**Raw Source**:
An immutable original document (article, paper, audio/chat transcript) curated by the user and preserved in the vault's source archive.
_Avoid_: input file, raw data, document

**Wiki**:
The persistent, compounding network of cross-linked markdown files compiled and maintained by the LLM.
_Avoid_: output folder, compiled docs, cache

**Index**:
The content-oriented catalog document (`index.md`) categorizing and summarizing every page in the wiki.
_Avoid_: table of contents, sitemap, manifest

**Log**:
The append-only chronological audit trail (`log.md`) recording all ingestions, queries, and maintenance passes.
_Avoid_: changelog, history, audit

### Operations

**Ingestion**:
The workflow of reading an immutable raw source, extracting entities and concepts, cross-linking with `[[wikilinks]]`, and updating the index and log.
_Avoid_: parsing, indexing, chunking, embedding

**Synthesis Query**:
An inquiry answered by navigating existing wiki pages and synthesizing insights, optionally filed back into the wiki as a permanent note.
_Avoid_: RAG retrieval, chat lookup

**Lint Pass**:
A health-check inspection of the wiki to detect orphan pages, broken links, outdated claims, or factual contradictions.
_Avoid_: format check, validation

### Interaction Surfaces

**CLI Surface**:
The standalone command-line interface executable via `npx` or global install.
_Avoid_: shell script, terminal runner

**MCP Surface**:
The Model Context Protocol server exposing wiki inspection and editing tools directly to AI coding agents.
_Avoid_: plugin server, agent bridge

**Skill Surface**:
The instruction rules and prompt workflows (e.g. `SKILL.md` / `CLAUDE.md`) that guide an agent to act as a disciplined wiki librarian.
_Avoid_: system prompt, prompt template
