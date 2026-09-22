import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './storage.js';

export type AgentTarget = 'claude' | 'cursor' | 'windsurf' | 'agents' | 'gemini' | 'cline' | 'copilot' | 'zed' | 'continue';

export interface AgentOptionInfo {
  id: AgentTarget;
  name: string;
  description: string;
}

export const ALL_AGENT_INFOS: AgentOptionInfo[] = [
  { id: 'cursor', name: 'Cursor', description: 'Cursor rules (.cursor/rules/*.mdc) and MCP server (.cursor/mcp.json)' },
  { id: 'claude', name: 'Claude Code', description: 'Claude Code rules (CLAUDE.md) and project MCP (.mcp.json)' },
  { id: 'agents', name: 'Codex / Antigravity / Generic', description: 'Universal rules (AGENTS.md) and project MCP (.mcp.json, .agents/plugins/)' },
  { id: 'cline', name: 'Cline / Roo Code', description: 'Cline/Roo rules (.clinerules) and MCP (.cline/mcp.json, .roo/mcp.json)' },
  { id: 'copilot', name: 'GitHub Copilot / VS Code', description: 'Copilot rules (.github/copilot-instructions.md) and MCP (.vscode/mcp.json)' },
  { id: 'windsurf', name: 'Windsurf', description: 'Cascade rules (.windsurfrules) and workspace MCP (.windsurf/mcp.json)' },
  { id: 'gemini', name: 'Gemini CLI / Code Assist', description: 'Gemini rules (GEMINI.md) and project MCP (.gemini/settings.json)' },
  { id: 'zed', name: 'Zed', description: 'Zed context servers (.zed/settings.json)' },
  { id: 'continue', name: 'Continue.dev', description: 'Continue rules (.continue/rules/) and MCP (.continue/mcpServers/)' },
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

  if ((await checkExists('AGENTS.md')) || (await checkExists('.agents'))) {
    detected.push('agents');
  }

  if (
    (await checkExists('.cline')) ||
    (await checkExists('.clinerules')) ||
    (await checkExists('.roomodes')) ||
    (await checkExists('.roo'))
  ) {
    detected.push('cline');
  }

  if ((await checkExists('.vscode')) || (await checkExists('.github/copilot-instructions.md'))) {
    detected.push('copilot');
  }

  if ((await checkExists('.windsurfrules')) || (await checkExists('.codeium')) || (await checkExists('.windsurf'))) {
    detected.push('windsurf');
  }

  if ((await checkExists('GEMINI.md')) || (await checkExists('.gemini'))) {
    detected.push('gemini');
  }

  if (await checkExists('.zed')) {
    detected.push('zed');
  }

  if (await checkExists('.continue')) {
    detected.push('continue');
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

### 1. Knowledge Query Workflow
When answering domain concepts, technical comparisons, or architectural questions:
1. **Wiki as Ground Truth**: The local \`wiki/\` is your primary source of domain knowledge. Resolve questions via MCP \`wiki_search\` (keyword lookup) or \`wiki_read_index\` (catalog survey) before falling back to general assumptions.
2. **Graph Traversal**: Inspect matching notes via MCP \`wiki_read_note\`. Follow its \`links\` (outbound concepts) and \`backlinks\` (inbound references) to walk related 1-hop neighbor nodes for full context.
3. **Compound Answers**: When a synthesis or comparative exploration yields durable conclusions, file it to \`wiki/syntheses/<Title>.md\` via \`wiki_write_note\` and log it via \`wiki_append_log\`.

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

    // File exists: check if the section heading is already present (exact heading match)
    if (existingContent.includes(librarianSectionHeading)) {
      skipped.push(relPath);
      return;
    }

    // Non-destructively append to existing content
    const updatedContent = `${existingContent.trimEnd()}\n\n${librarianSectionHeading}\n${librarianSectionBody}\n`;
    await atomicWriteFile(fullPath, updatedContent);
    updated.push(relPath);
  };

  // Write a dedicated rule file only if it doesn't exist yet
  const createOnce = async (relPath: string, content: string) => {
    try {
      await fs.access(path.join(vaultDir, relPath));
      skipped.push(relPath);
    } catch {
      await atomicWriteFile(path.join(vaultDir, relPath), content);
      created.push(relPath);
    }
  };

  for (const target of targets) {
    switch (target) {
      case 'cursor': {
        await createOnce('.cursor/rules/llmwiki.mdc', `---
description: LLM Wiki librarian guidelines for maintaining the knowledge base
globs: ["wiki/**/*.md", "raw/**/*", "index.md", "log.md"]
alwaysApply: true
---
# Cursor Rules - LLM Wiki Librarian
${librarianSectionBody}
`);
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

      case 'continue': {
        await createOnce('.continue/rules/llmwiki.md', `# Continue.dev Rules - LLM Wiki Librarian\n${librarianSectionBody}\n`);
        break;
      }

      default:
        break;
    }
  }

  return { created, updated, skipped };
}

/**
 * Strips comments (// and /* ... *\/) and trailing commas from JSON/JSONC text,
 * preserving string literals and escape characters.
 */
export function stripJsonComments(jsonString: string): string {
  let insideString = false;
  let stringChar = '';
  let isEscaped = false;
  let result = '';

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];
    const nextChar = jsonString[i + 1];

    if (insideString) {
      result += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === stringChar) {
        insideString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      insideString = true;
      stringChar = char;
      result += char;
      continue;
    }

    // Single-line comment: // ...
    if (char === '/' && nextChar === '/') {
      const endOfLine = jsonString.indexOf('\n', i);
      if (endOfLine === -1) {
        break;
      }
      i = endOfLine - 1;
      continue;
    }

    // Multi-line comment: /* ... */
    if (char === '/' && nextChar === '*') {
      const endOfBlock = jsonString.indexOf('*/', i + 2);
      if (endOfBlock === -1) {
        break;
      }
      i = endOfBlock + 1;
      continue;
    }

    result += char;
  }

  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Merges a server definition into an existing or new MCP configuration JSON string.
 */
export function mergeMcpConfig(existingContent: string, serverName: string, serverDef: any, containerKey: string = 'mcpServers'): string {
  let config: any = {};
  if (existingContent.trim()) {
    try {
      config = JSON.parse(existingContent);
    } catch {
      try {
        config = JSON.parse(stripJsonComments(existingContent));
      } catch {
        config = {};
      }
    }
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

  const updateConfigFile = async (
    relPath: string,
    containerKey: string = 'mcpServers',
    customDef: any = defaultLlmwikiMcpDef
  ) => {
    const fullPath = path.join(vaultDir, relPath);
    let existingContent = '';
    try {
      existingContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      existingContent = '';
    }

    const merged = mergeMcpConfig(existingContent, 'llmwiki', customDef, containerKey);
    await atomicWriteFile(fullPath, merged);
    updatedFiles.push(relPath.replace(/\\/g, '/'));
  };

  // 1. Cursor: .cursor/mcp.json
  if (targets.includes('cursor')) {
    await updateConfigFile('.cursor/mcp.json', 'mcpServers');
  }

  // 2. Claude Code: .mcp.json
  if (targets.includes('claude')) {
    await updateConfigFile('.mcp.json', 'mcpServers');
  }

  // 3. Codex / Antigravity / Generic: .mcp.json AND workspace plugin in .agents/plugins/llmwiki/
  if (targets.includes('agents')) {
    await updateConfigFile('.mcp.json', 'mcpServers');

    // Antigravity (agy / IDE) plugin auto-discovery
    const pluginManifestRelPath = '.agents/plugins/llmwiki/plugin.json';
    const pluginManifestFullPath = path.join(vaultDir, pluginManifestRelPath);
    try {
      await fs.access(pluginManifestFullPath);
    } catch {
      const pluginManifest = {
        name: 'llmwiki',
        description: 'LLM Wiki Agent Knowledge Base MCP Server',
      };
      await atomicWriteFile(pluginManifestFullPath, JSON.stringify(pluginManifest, null, 2) + '\n');
    }
    await updateConfigFile('.agents/plugins/llmwiki/mcp_config.json', 'mcpServers');
  }

  // 4. Cline & Roo Code: .cline/mcp.json, .cline/mcp_settings.json, .roo/mcp.json
  if (targets.includes('cline')) {
    await updateConfigFile('.cline/mcp.json', 'mcpServers');
    await updateConfigFile('.cline/mcp_settings.json', 'mcpServers');
    await updateConfigFile('.roo/mcp.json', 'mcpServers');
  }

  // 5. GitHub Copilot / VS Code: .vscode/mcp.json
  if (targets.includes('copilot')) {
    const vsCodeMcpDef = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@tymolu/llmwiki', 'mcp'],
    };
    await updateConfigFile('.vscode/mcp.json', 'servers', vsCodeMcpDef);
  }

  // 6. Gemini CLI / Code Assist: .gemini/settings.json & .mcp.json
  if (targets.includes('gemini')) {
    await updateConfigFile('.gemini/settings.json', 'mcpServers');
    await updateConfigFile('.mcp.json', 'mcpServers');
  }

  // 7. Windsurf: .codeium/windsurf/mcp_config.json & .windsurf/mcp.json
  if (targets.includes('windsurf')) {
    await updateConfigFile('.codeium/windsurf/mcp_config.json', 'mcpServers');
    await updateConfigFile('.windsurf/mcp.json', 'mcpServers');
  }

  // 8. Zed: .zed/settings.json (context_servers)
  if (targets.includes('zed')) {
    await updateConfigFile('.zed/settings.json', 'context_servers');
  }

  // 9. Continue.dev: .continue/mcpServers/llmwiki.yaml
  if (targets.includes('continue')) {
    const continueYamlPath = path.join(vaultDir, '.continue', 'mcpServers', 'llmwiki.yaml');
    const continueYaml = `name: llmwiki
version: 0.1.0
schema: v1
mcpServers:
  - name: llmwiki
    command: npx
    args:
      - "-y"
      - "@tymolu/llmwiki"
      - "mcp"
`;
    await atomicWriteFile(continueYamlPath, continueYaml);
    updatedFiles.push('.continue/mcpServers/llmwiki.yaml');
  }

  return Array.from(new Set(updatedFiles));
}
