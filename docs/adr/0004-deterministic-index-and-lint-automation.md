# Deterministic Index and Lint Automation

`llmwiki` delegates semantic understanding, entity extraction, and synthesis note writing to the driving AI Agent, while reserving structural and bookkeeping tasks (catalog indexing in `index.md`, link graph calculation, backlink counts, orphan detection, and broken link linting) for deterministic Node.js TypeScript code.

This relieves the agent of tedious accounting chores, prevents formatting drift in the index, conserves the agent's context window, and guarantees reproducible vault integrity.
