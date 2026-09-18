# Agent-First Architecture (Zero LLM Configuration)

`llmwiki` does not embed an LLM SDK, API client, or require external API keys. Instead, it is an **Agent-First** tool suite where the driving AI agent (Claude Code, Cursor, Windsurf, Antigravity, etc.) acts as the intelligence layer.

`llmwiki` provides:
1. Vault structure scaffolding (`init`)
2. Deterministic graph, search, index reconciliation, and linting engines
3. An MCP server exposing atomic vault operations to agents
4. Agent Skill rules (`AGENTS.md` / `CLAUDE.md` / `SKILL.md`) instructing the agent on ingestion and maintenance workflows

This eliminates all API key configuration, secret management, and model provider lock-in, making the tool zero-config and completely free to run on top of whatever AI environment the user already uses.
