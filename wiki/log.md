# Wiki Log

Append-only chronological audit trail of all knowledge base operations.

## [2026-09-18] init | Vault initialized
- Scaffolded directory structure (`raw/`, `wiki/entities/`, `wiki/concepts/`, `wiki/syntheses/`)
- Generated wiki/index.md, wiki/log.md, and agent configurations

## [2026-09-28] maintenance | P0/P1 audit fixes
- Fixed empty-wiki root-scan flood (scanMarkdownFiles now excludes dot-dirs, node_modules, raw/)
- Fixed silent destruction of malformed MCP configs; merge failures now skip with a warning
- Obsidian embeds ![[image.png]] no longer reported as broken links; lint line numbers now account for frontmatter
- Added [[concepts/Foo]] shortest-path resolution; atomic log appends; Windows reserved-name guard
- Aligned docs (AGENTS.md, spec, ADR-0001) with scoped package @tymolu/llmwiki and 7 MCP tools
- Added .gitkeep to raw/ and wiki note directories

## [2026-09-28] maintenance | Follow-up engineering fixes
- Implemented untracked-notes lint check (spec gap): notes missing from index.md between LLMWIKI markers now warn
- Test suite now typechecked (tsconfig include test, tsconfig.build.json for emit); mcp tests re-typed without `as any`
- Added @vitest/coverage-v8 + `npm run test:coverage` (87.45% stmts, src/core 93.59%)
- Symlink/junction containment hardening (assertPathContainedReal/safeWriteFileWithin) on all vault write paths
