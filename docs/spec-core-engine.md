# Spec: Agent-First LLM Wiki Core Engine (CLI, MCP & Skills)

## Problem Statement

Knowledge workers, researchers, and developers accumulating insights over weeks or months face a fundamental friction:
1. Traditional Retrieval-Augmented Generation (RAG) is stateless—every inquiry starts from scratch, rediscovering connections and re-synthesizing raw document fragments without compounding long-term understanding.
2. Manually curating and maintaining a personal Zettelkasten or digital wiki (summarizing sources, extracting entities, cross-referencing with `[[wikilinks]]`, auditing dead links, and keeping a catalog index up to date) imposes a cognitive and bookkeeping burden that causes humans to abandon their wikis.
3. Existing experimental LLM wiki tools often require burdensome API key configurations, mandate local desktop GUI installations, or tightly couple to a single proprietary editor ecosystem.

Developers need an open, zero-configuration, agent-native toolchain distributed via npm (`npx llmwiki`) that provides deterministic vault scaffolding, automated indexing, graph auditing, and a standard Model Context Protocol (MCP) server that empowers any driving AI coding agent (Claude Code, Cursor, Windsurf, Antigravity) to act as an autonomous wiki librarian over standard Markdown files.

## Solution

`llmwiki` is an open-source, vendor-agnostic, Agent-First toolkit published to npm. It introduces a tripartite architecture:
1. **Scaffolding & Deterministic CLI Surface**: An instant `npx llmwiki init` command that scaffolds an open Markdown vault structure (`raw/`, `wiki/entities/`, `wiki/concepts/`, `wiki/syntheses/`, `index.md`, `log.md`), combined with deterministic high-speed CLI utilities (`index`, `lint`, `search`) that handle structural housekeeping and dead-link auditing without burning LLM tokens.
2. **Standard stdio MCP Server Surface**: A native Model Context Protocol server (`npx llmwiki mcp`) exposing 6 atomic vault management tools directly to AI coding agents for reading, searching, writing notes, and appending logs.
3. **Agent Skill & Instruction Surface**: Pre-configured guidelines (`AGENTS.md`, `CLAUDE.md`, and `SKILL.md`) that teach external agents the exact conventions for source ingestion, entity synthesis, and wikilink cross-referencing.

The entire system requires zero LLM API keys or inference configurations in the CLI itself, relying entirely on the driving agent's existing intelligence.

## User Stories

1. As a knowledge worker, I want to run `npx llmwiki init [path]`, so that I can immediately scaffold a complete, structured Markdown vault with standard directories and agent instructions in seconds.
2. As a knowledge worker, I want the generated vault to consist of 100% standard CommonMark files, so that I can open and navigate it in Obsidian, VS Code, Cursor, or GitHub Web without vendor lock-in.
3. As an Obsidian user, I want notes to use standard `[[wikilinks]]` and YAML frontmatter, so that Obsidian can automatically resolve shortest paths, display backlinks, and render the interactive Graph View.
4. As an AI coding agent, I want to connect to `llmwiki` via a standard stdio MCP server, so that I can natively inspect and modify the vault using structured tools.
5. As an AI coding agent, I want a `wiki_read_index` tool, so that I can quickly understand the existing catalog of concepts, entities, and synthesis documents before deciding where to link new information.
6. As an AI coding agent, I want a `wiki_read_note` tool, so that I can fetch the verbatim markdown content and frontmatter of any existing note by title or relative path.
7. As an AI coding agent, I want a `wiki_write_note` tool, so that I can write or update concept and entity pages under the appropriate subdirectories (`entities/`, `concepts/`, `syntheses/`).
8. As an AI coding agent, I want a `wiki_search` tool, so that I can run keyword and phrase queries across all notes to find relevant context when answering synthesis queries.
9. As an AI coding agent, I want a `wiki_append_log` tool, so that I can append timestamped audit entries to `log.md` recording what raw sources were ingested or what operations occurred.
10. As an AI coding agent, I want a `wiki_lint` tool, so that I can audit the knowledge base for broken links, unindexed files, and orphan notes without leaving my agent loop.
11. As a vault maintainer, I want to run `npx llmwiki index`, so that the program automatically scans all markdown files under `wiki/` and idempotently rebuilds `index.md` with updated titles, summaries, and incoming link counts.
12. As a vault maintainer, I want `index.md` reconciliation to be deterministic code, so that my agent does not waste thousands of tokens manually reformatting the catalog table on every ingestion.
13. As a vault maintainer, I want to run `npx llmwiki lint`, so that I can see an instant terminal report of all broken `[[wikilinks]]` that target non-existent files and all orphan notes that have zero incoming links.
14. As a terminal user, I want to run `npx llmwiki search <query>`, so that I can quickly search for notes containing specific terms directly from my shell.
15. As a developer using Claude Code or Antigravity, I want `AGENTS.md` and `CLAUDE.md` automatically configured in the vault root, so that the agent immediately recognizes its role as the wiki librarian upon entering the directory.
16. As an open-source contributor, I want a clean TypeScript codebase with comprehensive unit tests executed against temporary filesystem directories, so that the behavior is reliable across Windows, macOS, and Linux.

## Implementation Decisions

### Core Architecture & Packaging
- **Single Monolithic Package**: Distributed as a single npm package named `llmwiki` with binary entrypoint `bin/llmwiki.js` (CLI) and module export for the MCP server.
- **Pure TypeScript / Node.js 20+**: Written with native ESM, strict typing, and zero native binary dependencies to ensure universal cross-platform execution via `npx`.
- **Zero-LLM Configuration**: The library embeds no LLM client SDKs (no OpenAI/Anthropic/Gemini SDKs in dependencies). Intelligence is supplied strictly by the external driving agent.

### Vault Directory Layout
```
<vault-root>/
├── raw/                 # Immutable source documents (curated by human)
├── wiki/                # Persistent network of compiled markdown notes
│   ├── entities/        # Specific entities (people, tools, organizations, products)
│   ├── concepts/        # Abstract ideas, models, and domain theories
│   └── syntheses/       # High-level synthesis, comparisons, and research answers
├── index.md             # Automated catalog index of all wiki pages
├── log.md               # Append-only chronological audit log
└── AGENTS.md / CLAUDE.md# Agent guidelines and librarian rules
```

### Metadata & Linking Convention
- **Frontmatter**: Standard YAML parsed via `gray-matter`. Supports `title`, `type` (`entity` | `concept` | `synthesis`), `aliases`, `tags`, `sources`, and `last_updated`.
- **Wikilinks**: Standard `[[Note Title]]` or `[[path/to/Note Title|Alias]]` syntax.
- **Relative Path Resolution**: Link resolution algorithm matches case-insensitively by note title, basename, or alias.

### Deterministic Housekeeping Engine (`VaultEngine`)
- **Index Generator**: Scans `wiki/`, parses metadata, calculates inbound link counts, and outputs a formatted, categorized `index.md`.
- **Vault Linter**: Builds a bidirectional in-memory link graph:
  - Detects **broken links**: references `[[Target]]` where no corresponding file or alias exists.
  - Detects **orphan notes**: notes with zero incoming links.
  - Detects **untracked notes**: notes present on disk but omitted from `index.md`.
- **Search Engine**: Lightweight in-memory full-text search indexing title, frontmatter aliases/tags, and content with highlight snippet extraction.

### MCP Server Protocol Implementation
- Implements the Model Context Protocol (MCP) using `@modelcontextprotocol/sdk` over stdio transport.
- Exposes 6 atomic tools: `wiki_read_index`, `wiki_read_note`, `wiki_write_note`, `wiki_search`, `wiki_append_log`, `wiki_lint`.

## Testing Decisions

- **Testing Seam**: The public API of `VaultEngine` is the primary testing seam. Tests instantiate temporary directories on the real filesystem (`node:os.tmpdir()`), perform vault operations, and assert against disk state.
- **Black-Box Testing Philosophy**: Tests verify external behavior (files created, index markdown content, lint error collections, search result rankings), avoiding mocks of internal functions or filesystem APIs.
- **Cross-Platform Path Testing**: Path handling is explicitly tested for Windows backslashes (`\`) and POSIX forward slashes (`/`).
- **CLI & MCP End-to-End Tests**: Run subprocess executions of `bin/llmwiki.js` with simulated inputs to test CLI argument parsing, exit codes, and MCP stdio handshake.

## Out of Scope

- Hosting proprietary or cloud-based sync infrastructure (users sync via standard Git, GitHub, or Obsidian Sync).
- Building an embedded GUI or desktop client (users view via Obsidian, VS Code, or any markdown editor).
- Direct API billing, API key credential storage, or model token management.
- Modifying or deleting files in `raw/` (raw sources are strictly immutable).

## Further Notes

- Once this spec is confirmed and published, development proceeds test-first using `/tdd` through tracer-bullet tickets broken down by `/to-tickets`.
