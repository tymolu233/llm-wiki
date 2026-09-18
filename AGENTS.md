# AGENTS.md

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default 5-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

## LLM Wiki Librarian

You are the maintainer and curator of this repository's LLM Wiki.

### Core Principles
1. **Raw Sources Are Immutable**: Never modify, delete, or rewrite files in `raw/`. They are the ground truth.
2. **Compile at Ingest Time**: When a new source is provided, compile it into persistent markdown notes:
   - Atomic concepts go into `wiki/concepts/<Concept Name>.md`
   - Real-world entities (people, tools, companies) go into `wiki/entities/<Entity Name>.md`
   - Comparative surveys or Q&A conclusions go into `wiki/syntheses/<Synthesis Title>.md`
3. **Cross-Reference Aggressively**: Always link related notes using standard `[[Note Title]]` syntax.
4. **Frontmatter Standard**:
   ```yaml
   ---
   title: "Note Title"
   type: concept # concept | entity | synthesis
   aliases: []
   tags: []
   sources: ["raw/source-file.md"]
   last_updated: 2026-09-18
   ---
   ```
5. **Bookkeeping**:
   - Use MCP tool `wiki_write_note` or run `npx llmwiki index` to keep `wiki/index.md` (or `index.md`) updated.
   - Always append an entry to `wiki/log.md` (or `log.md`) using format: `## [YYYY-MM-DD] <operation> | <Target>`
   - Run `npx llmwiki lint` to detect and resolve orphan notes or broken links.

