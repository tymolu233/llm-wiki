# Single Package Multi-Surface Distribution

The `llmwiki` tool is distributed as a single npm package providing three unified entry surfaces: CLI (`npx llmwiki`), MCP server (`npx -y llmwiki mcp`), and Agent Skills (`AGENTS.md` / `CLAUDE.md` / `SKILL.md`).

This avoids fracturing the ecosystem into separate packages, keeps installation and zero-install `npx` usage frictionless, and provides a single versioned release lifecycle across all three interaction modes.
