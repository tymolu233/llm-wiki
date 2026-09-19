# llmwiki 🧠

> **Agent-First personal knowledge base engine.**  
> *"Stop Retrieving, Start Compiling."* Persistent, compounding wikis compiled by AI agents, browsed in Obsidian, VS Code, or any markdown editor.

[![CI](https://github.com/tymolu233/llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/tymolu233/llm-wiki/actions)
[![npm version](https://img.shields.io/npm/v/@tymolu/llmwiki.svg)](https://www.npmjs.com/package/@tymolu/llmwiki)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is an LLM Wiki?

Most document Q&A tools use stateless **RAG** (Retrieval-Augmented Generation): you upload raw files, the model re-chunks and re-synthesizes fragments from scratch on every question. Nothing compounds.

**`llmwiki` is different.** Instead of re-deriving knowledge every query:
1. You drop raw materials (articles, papers, transcripts) into `raw/`.
2. Your AI agent (Claude Code, Cursor, Windsurf, Antigravity) acts as an autonomous **librarian**—extracting entities, concepts, and cross-referencing notes using standard `[[wikilinks]]`.
3. The wiki becomes an evolving, permanent **second brain**.
4. You view the graph and navigate pages in **Obsidian** or **VS Code**, while `llmwiki` takes care of atomic writes, index reconciliation, and health auditing.

---

## ✨ Key Features

- **🚀 Zero Configuration (Agent-First)**: No API keys to configure, no LLM provider lock-in, zero billing overhead. `llmwiki` relies directly on the intelligence of whatever AI coding agent you already use.
- **⚡ Single Package, Multi-Surface**:
  - **CLI Surface**: `npx @tymolu/llmwiki init / status / index / lint / search`
  - **MCP Surface**: Standard stdio Model Context Protocol server exposing 7 atomic tools directly to agents.
  - **Skill Surface**: Pre-bundled librarian guidelines (`AGENTS.md` and `CLAUDE.md`).
- **🌐 Open Markdown Vault**: 100% standard CommonMark files. Open it in Obsidian for the graph view, edit it in VS Code/Cursor, or browse it on GitHub. Zero proprietary plugins required.
- **🛡️ Deterministic Housekeeping**: Automatically reconciles `index.md` and detects broken links and orphan notes in milliseconds without burning LLM tokens.
- **🔒 Atomic & Safe**: Uses atomic temporary file renames and strict path-containment validation to protect against accidental directory traversal.

---

## 📦 Quick Start

### 1. Initialize a Knowledge Base

In your project or notes directory:

```bash
npx @tymolu/llmwiki init
```

In interactive terminals (TTY), `llmwiki` presents a rich selection prompt (powered by `@clack/prompts`, similar to `npx skills add`) allowing you to select which agents to configure:

```
┌   llmwiki init — Agent-First Knowledge Base
│
◇  Select AI agents to configure with LLM Wiki rules:
│  ● Cursor (.cursor/rules/llmwiki.mdc & .cursor/mcp.json)
│  ● Claude Code (CLAUDE.md & .mcp.json)
│  ● Codex / Antigravity / Generic (AGENTS.md)
│  ○ Cline / Roo Code (.cline/mcp_settings.json)
│  ○ GitHub Copilot / VS Code (.vscode/mcp.json)
│  ○ Windsurf (.windsurfrules)
│  ○ Gemini CLI (GEMINI.md)
│  ○ Zed (.zed/settings.json)
│
◇  Configure project-level MCP server for selected agents?
│  Yes
└  Vault initialized successfully!
```

#### 🛡️ Safe & Non-Destructive Guarantee
`llmwiki` will **never** overwrite or erase your existing `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`. If files already exist (e.g. holding your Matt Pocock skills or custom coding guidelines), `llmwiki` safely appends an isolated `## LLM Wiki Librarian` section at the bottom. If the section is already present, it cleanly skips it without duplicates.

#### Non-Interactive / CI Flags:
```bash
# Configure all supported agents and MCP configurations automatically
npx @tymolu/llmwiki init --all

# Specify exact agents non-interactively
npx @tymolu/llmwiki init --agent cursor,claude

# Place index.md and log.md in vault root (optional fallback)
npx @tymolu/llmwiki init --root-index

# Skip MCP server configuration
npx @tymolu/llmwiki init --agent claude --no-mcp

# Accept auto-detected defaults silently
npx @tymolu/llmwiki init -y
```

This scaffolds:
```
my-vault/
├── raw/                 # Immutable source documents (curated by you)
├── wiki/                # Self-contained knowledge base
│   ├── index.md         # Categorized catalog index with backlink stats
│   ├── log.md           # Append-only chronological audit trail
│   ├── entities/        # People, tools, organizations, products
│   ├── concepts/        # Abstract models, core theories
│   └── syntheses/       # Deep comparative summaries and Q&A answers
├── AGENTS.md / CLAUDE.md# Safely adapted librarian rules for your AI Agent
└── .cursor/ / .mcp.json # Auto-configured project MCP settings
```

### 2. Manual Connect (Optional)

If you didn't auto-configure MCP during `init`, you can add it at any time:

#### Claude Code:
```bash
claude mcp add llmwiki -- npx -y @tymolu/llmwiki mcp
```

#### Cursor (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["-y", "@tymolu/llmwiki", "mcp"]
    }
  }
}
```

#### Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["-y", "@tymolu/llmwiki", "mcp", "/absolute/path/to/vault"]
    }
  }
}
```

---

## 🛠️ CLI Commands

```bash
# Initialize a new vault
npx @tymolu/llmwiki init [path]

# Display vault overview, graph hubs, and pending raw compilation sources
npx @tymolu/llmwiki status [path]
npx @tymolu/llmwiki status [path] --json

# Rebuild catalog index.md (non-destructively preserves your custom notes)
npx @tymolu/llmwiki index [path]

# Audit vault health (detects broken [[links]], orphan notes, case-mismatches)
npx @tymolu/llmwiki lint [path]

# Search vault notes with highlighted context snippets
npx @tymolu/llmwiki search "query" [path]
npx @tymolu/llmwiki search "query" --json

# Start stdio MCP server
npx @tymolu/llmwiki mcp [path]
```

---

## 🔌 MCP Tools Reference

When connected via MCP, your AI agent has access to 7 atomic tools:

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `wiki_status` | none | Returns complete vault diagnostic: note counts, graph hubs, and uncompiled pending raw sources. |
| `wiki_read_index` | none | Returns the content of `index.md` summarizing all indexed notes with backlink counts. |
| `wiki_read_note` | `pathOrTitle` | Reads note frontmatter, body, outbound `links`, and incoming `backlinks` (with source titles). |
| `wiki_write_note` | `category`, `title`, `content`, `frontmatter` | Atomically creates/updates notes under `entities/`, `concepts/`, or `syntheses/` and updates the index. |
| `wiki_search` | `query`, `limit` | Searches notes with relevance scoring and snippet previews. |
| `wiki_append_log` | `operation`, `title`, `details` | Appends a standardized audit entry to `log.md`. |
| `wiki_lint` | none | Runs full-vault diagnostic check for broken links, case-mismatches, and orphan notes. |

---

## 🤖 Example Agent Workflows

Once installed, simply talk to your agent in natural language:

### 1. Ingesting Sources
> **You**: *"Agent, please read `raw/raft-paper.pdf` and ingest it into the wiki."*  
> **Agent**: Calls `wiki_write_note` to create `wiki/concepts/Raft.md` and `wiki/concepts/Consensus.md` with cross-linking `[[wikilinks]]`, updates `log.md`, and refreshes `index.md`.

### 2. Synthesizing Knowledge
> **You**: *"What are the core trade-offs between Raft and Paxos based on our wiki?"*  
> **Agent**: Calls `wiki_search` and `wiki_read_note`, synthesizes the comparison, and optionally files it to `wiki/syntheses/Raft-vs-Paxos.md`.

### 3. Health Auditing
> **You**: *"Check the health of our wiki and fix any broken links."*  
> **Agent**: Calls `wiki_lint`, reviews any unresolved references, and edits the affected notes.

---

## 📄 License

MIT © [tymolu233](https://github.com/tymolu233)
