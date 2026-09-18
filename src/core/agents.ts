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
  { id: 'agents', name: 'Codex / Antigravity / Generic', description: 'Universal Agent rules (AGENTS.md)' },
  { id: 'cline', name: 'Cline / Roo Code', description: 'Cline rules (.clinerules) and MCP settings (.cline/mcp_settings.json)' },
  { id: 'copilot', name: 'GitHub Copilot / VS Code', description: 'Copilot rules (.github/copilot-instructions.md) and MCP (.vscode/mcp.json)' },
  { id: 'windsurf', name: 'Windsurf', description: 'Cascade rules (.windsurfrules)' },
  { id: 'gemini', name: 'Gemini CLI', description: 'Gemini CLI rules (GEMINI.md)' },
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
You are the maintainer and curator of this repository's LLM Wiki (based on Andrej Karpathy's LLM Wiki pattern).

### Core Principles
1. **Raw Sources Are Immutable**: Never modify, delete, or rewrite files in \`raw/\`. They are the ground truth.
2. **Compile at Ingest Time**: When a new source is provided, compile it into persistent markdown notes rather than only answering in chat:
   - Atomic principles & models -> \`wiki/concepts/<Concept Name>.md\`
   - Real-world entities (tools, people, organizations) -> \`wiki/entities/<Entity Name>.md\`
   - Overarching summaries & comparisons -> \`wiki/syntheses/<Synthesis Title>.md\`
   - **Update Existing Notes**: Don't just create new notes—revise existing pages if the new source adds context, resolves discrepancies, or contradicts older claims.
3. **Cross-Reference Aggressively**: Always link related notes using standard Obsidian \`[[Note Title]]\` wikilinks.
4. **Compound Good Answers**: When answering complex questions or comparative queries, file valuable conclusions back into \`wiki/syntheses/<Title>.md\` so explorations compound in the wiki.
5. **Frontmatter Standard**:
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
6. **Bookkeeping & Health**:
   - Query: Consult \`wiki/index.md\` (or \`index.md\`) or use MCP \`wiki_read_index\` / \`wiki_search\` first, then drill into pages with \`wiki_read_note\`.
   - Write: Use MCP tool \`wiki_write_note\` (or write markdown) and run \`npx llmwiki index\` to keep index updated.
   - Audit Trail: Always append an entry to \`wiki/log.md\` (or \`log.md\`) using format: \`## [YYYY-MM-DD] <operation> | <Target>\`
   - Quality: Run \`npx llmwiki lint\` (or MCP \`wiki_lint\`) to detect and resolve orphan notes or broken links.
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
    args: ['-y', 'llmwiki', 'mcp'],
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

  if (targets.includes('claude')) {
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
      args: ['-y', 'llmwiki', 'mcp'],
    };
    await updateConfigFile('.vscode/mcp.json', 'servers', vsCodeMcpDef);
  }

  if (targets.includes('zed')) {
    await updateConfigFile('.zed/settings.json', 'context_servers');
  }

  return updatedFiles;
}
