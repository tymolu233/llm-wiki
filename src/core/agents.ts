import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './storage.js';

export type AgentTarget = 'claude' | 'cursor' | 'windsurf' | 'agents' | 'gemini' | 'cline' | 'copilot' | 'zed';

export interface AgentOptionInfo {
  id: AgentTarget;
  name: string;
  description: string;
}

export const ALL_AGENT_INFOS: AgentOptionInfo[] = [
  { id: 'cursor', name: 'Cursor', description: 'Cursor rules (.cursor/rules/*.mdc) and MCP server (.cursor/mcp.json)' },
  { id: 'claude', name: 'Claude Code', description: 'Claude Code rules (CLAUDE.md) and project MCP (.mcp.json)' },
  { id: 'agents', name: 'Codex / Antigravity / Generic', description: 'Universal Agent rules (AGENTS.md) and project MCP (.mcp.json)' },
  { id: 'cline', name: 'Cline / Roo Code', description: 'Cline rules (.clinerules) and MCP settings (.cline/mcp_settings.json)' },
  { id: 'copilot', name: 'GitHub Copilot / VS Code', description: 'Copilot rules (.github/copilot-instructions.md) and MCP (.vscode/mcp.json)' },
  { id: 'windsurf', name: 'Windsurf', description: 'Cascade rules (.windsurfrules)' },
  { id: 'gemini', name: 'Gemini CLI', description: 'Gemini CLI rules (GEMINI.md) and project MCP (.mcp.json)' },
  { id: 'zed', name: 'Zed', description: 'Zed context servers (.zed/settings.json)' },
];

export const ALL_AGENTS: AgentTarget[] = ALL_AGENT_INFOS.map((a) => a.id);

/**
 * Detects existing agent configurations in the workspace.
 * If none found, defaults to ['claude', 'cursor', 'agents'].
 */
export async function detectAgentEnvironments(vaultDir: string): Promise<AgentTarget[]> {
  const detected: AgentTarget[] = [];

  const checkExists = async (relPath: string): Promise<boolean> => {
    try {
      await fs.access(path.join(vaultDir, relPath));
      return true;
    } catch {
      return false;
    }
  };

  if ((await checkExists('.cursor')) || (await checkExists('.cursorrules'))) {
    detected.push('cursor');
  }

  if ((await checkExists('.claude')) || (await checkExists('CLAUDE.md'))) {
    detected.push('claude');
  }

  if (await checkExists('AGENTS.md')) {
    detected.push('agents');
  }

  if ((await checkExists('.cline')) || (await checkExists('.roomodes'))) {
    detected.push('cline');
  }

  if ((await checkExists('.vscode')) || (await checkExists('.github/copilot-instructions.md'))) {
    detected.push('copilot');
  }

  if ((await checkExists('.windsurfrules')) || (await checkExists('.codeium'))) {
    detected.push('windsurf');
  }

  if (await checkExists('GEMINI.md')) {
    detected.push('gemini');
  }

  if (await checkExists('.zed')) {
    detected.push('zed');
  }

  if (detected.length === 0) {
    return ['claude', 'cursor', 'agents'];
  }

  return Array.from(new Set(detected));
}

export interface AgentRulesResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

/**
 * Generates or non-destructively updates agent-specific rule and instruction files.
 * CRUCIAL: Existing AGENTS.md, CLAUDE.md, etc., are NEVER overwritten.
 * Rules are appended under an isolated "## LLM Wiki Librarian" section.
 */
export async function configureAgentRules(
  vaultDir: string,
  targets: AgentTarget[]
): Promise<AgentRulesResult> {
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const librarianSectionHeading = '## LLM Wiki Librarian';
  const librarianSectionBody = `
You are the maintainer, researcher, and domain expert for this repository's LLM Wiki (based on Andrej Karpathy's LLM Wiki pattern).

### 1. Mandatory Knowledge Query Protocol (READ THIS FIRST)
Whenever the user asks any conceptual, technical, architectural, or domain question (e.g. "如何使用...", "什么是...", "对比..."):
- **CRITICAL CONSTRAINT: NEVER use generic file search tools (\`Find\`, \`Glob\`, \`Grep\`, \`Read\`) directly on files under \`wiki/\`.**
- **Step 1 (Locate)**: Always query the knowledge base first using MCP \`wiki_search\` (with targeted keywords) or \`wiki_read_index\` to discover existing concepts, entities, and syntheses.
- **Step 2 (Traverse Graph)**: Read matching notes using MCP \`wiki_read_note\`. Inspect their \`links\` (outbound concepts) and \`backlinks\` (inbound references) to explore 1-hop / 2-hop neighbor nodes in the knowledge graph.
- **Step 3 (Synthesize & Compound)**: Formulate a grounded, comprehensive answer. If your investigation generates a valuable technical synthesis, architectural comparison, or definitive answer, use MCP \`wiki_write_note\` to persist it to \`wiki/syntheses/<Title>.md\` and log it via \`wiki_append_log\`.

### 2. Ingest & Compilation Protocol
When the user provides new raw material or requests ingestion:
- **Raw Sources Are Immutable**: Never modify, delete, or rewrite files in \`raw/\`. They are the ground truth.
- **Compile to Atomic Markdown Notes**:
  - Atomic principles & models -> \`wiki/concepts/<Concept Name>.md\`
  - Real-world entities (tools, libraries, people, orgs) -> \`wiki/entities/<Entity Name>.md\`
  - Comparative surveys & Q&A summaries -> \`wiki/syntheses/<Synthesis Title>.md\`
  - **Update Existing Notes**: Revise existing pages when new sources add context or resolve discrepancies.
- **Cross-Reference Aggressively**: Always link related notes using standard Obsidian \`[[Note Title]]\` wikilinks.

### 3. Frontmatter Standard
\`\`\`yaml
---
title: "Note Title"
type: concept # concept | entity | synthesis
aliases: []
tags: []
sources: ["raw/source-file.md"]
last_updated: ${today}
---
\`\`\`

### 4. Bookkeeping & Quality
- **Write**: Use MCP \`wiki_write_note\` (or run \`npx llmwiki index\` after edits).
- **Audit Trail**: Always log operations via MCP \`wiki_append_log\` (or append to \`wiki/log.md\`).
- **Health**: Periodically run MCP \`wiki_lint\` (or \`npx llmwiki lint\`) to detect and resolve orphan notes or broken links.
`;

  const safeAppend = async (relPath: string, fileDefaultTitle: string) => {
    const fullPath = path.join(vaultDir, relPath);
    let existingContent = '';
    let fileExists = false;

    try {
      existingContent = await fs.readFile(fullPath, 'utf-8');
      fileExists = true;
    } catch {
      fileExists = false;
    }

    if (!fileExists) {
      const initialContent = `# ${fileDefaultTitle}\n\n${librarianSectionHeading}\n${librarianSectionBody}\n`;
      await atomicWriteFile(fullPath, initialContent);
      created.push(relPath);
      return;
    }

    // File exists: check if section is already present
    if (existingContent.includes(librarianSectionHeading) || existingContent.includes('LLM Wiki Librarian')) {
      skipped.push(relPath);
      return;
    }

    // Non-destructively append to existing content
    const updatedContent = `${existingContent.trimEnd()}\n\n${librarianSectionHeading}\n${librarianSectionBody}\n`;
    await atomicWriteFile(fullPath, updatedContent);
    updated.push(relPath);
  };

  for (const target of targets) {
    switch (target) {
      case 'cursor': {
        const fullPath = path.join(vaultDir, '.cursor/rules/llmwiki.mdc');
        let exists = false;
        try {
          await fs.access(fullPath);
          exists = true;
        } catch {
          exists = false;
        }

        if (exists) {
          skipped.push('.cursor/rules/llmwiki.mdc');
        } else {
          const cursorMdc = `---
description: LLM Wiki librarian guidelines for maintaining the knowledge base
globs: ["wiki/**/*.md", "raw/**/*", "index.md", "log.md"]
alwaysApply: true
---
# Cursor Rules - LLM Wiki Librarian
${librarianSectionBody}
`;
          await atomicWriteFile(fullPath, cursorMdc);
          created.push('.cursor/rules/llmwiki.mdc');
        }
        break;
      }

      case 'claude': {
        await safeAppend('CLAUDE.md', 'CLAUDE.md');
        break;
      }

      case 'agents': {
        await safeAppend('AGENTS.md', 'AGENTS.md');
        break;
      }

      case 'windsurf': {
        await safeAppend('.windsurfrules', 'Windsurf Rules');
        break;
      }

      case 'gemini': {
        await safeAppend('GEMINI.md', 'GEMINI.md');
        break;
      }

      case 'copilot': {
        await safeAppend('.github/copilot-instructions.md', 'GitHub Copilot Instructions');
        break;
      }

      case 'cline': {
        await safeAppend('.clinerules', 'Cline Rules');
        break;
      }

      default:
        break;
    }
  }

  return { created, updated, skipped };
}

/**
 * Merges a server definition into an existing or new MCP configuration JSON string.
 */
export function mergeMcpConfig(existingContent: string, serverName: string, serverDef: any, containerKey: string = 'mcpServers'): string {
  let config: any = {};
  try {
    if (existingContent.trim()) {
      config = JSON.parse(existingContent);
    }
  } catch {
    config = {};
  }

  // Preserve existing container key if present
  let keyToUse = containerKey;
  if (containerKey === 'servers' && config.mcpServers && !config.servers) {
    keyToUse = 'mcpServers';
  } else if (containerKey === 'mcpServers' && config.servers && !config.mcpServers) {
    keyToUse = 'servers';
  }

  if (!config[keyToUse] || typeof config[keyToUse] !== 'object') {
    config[keyToUse] = {};
  }

  config[keyToUse][serverName] = serverDef;
  return JSON.stringify(config, null, 2) + '\n';
}

/**
 * Configures local project-level MCP server configurations for supported agents.
 */
export async function configureAgentMcp(vaultDir: string, targets: AgentTarget[]): Promise<string[]> {
  const updatedFiles: string[] = [];

  const defaultLlmwikiMcpDef = {
    command: 'npx',
    args: ['-y', '@tymolu/llmwiki', 'mcp'],
  };

  const updateConfigFile = async (relPath: string, containerKey: string = 'mcpServers', customDef: any = defaultLlmwikiMcpDef) => {
    const fullPath = path.join(vaultDir, relPath);
    let existingContent = '';
    try {
      existingContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      existingContent = '';
    }

    const merged = mergeMcpConfig(existingContent, 'llmwiki', customDef, containerKey);
    await atomicWriteFile(fullPath, merged);
    updatedFiles.push(relPath);
  };

  if (targets.includes('cursor')) {
    await updateConfigFile('.cursor/mcp.json', 'mcpServers');
  }

  if (targets.includes('claude') || targets.includes('agents') || targets.includes('gemini')) {
    await updateConfigFile('.mcp.json', 'mcpServers');
  }

  if (targets.includes('cline')) {
    await updateConfigFile('.cline/mcp_settings.json', 'mcpServers');
  }

  if (targets.includes('copilot')) {
    // Official VS Code MCP configuration uses 'servers' with type 'stdio'
    const vsCodeMcpDef = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@tymolu/llmwiki', 'mcp'],
    };
    await updateConfigFile('.vscode/mcp.json', 'servers', vsCodeMcpDef);
  }

  if (targets.includes('zed')) {
    await updateConfigFile('.zed/settings.json', 'context_servers');
  }

  return updatedFiles;
}
