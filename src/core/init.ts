import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './storage.js';
import {
  AgentTarget,
  ALL_AGENTS,
  detectAgentEnvironments,
  configureAgentRules,
  configureAgentMcp,
} from './agents.js';

export interface InitOptions {
  vaultDir: string;
  force?: boolean;
  agents?: AgentTarget[];
  allAgents?: boolean;
  configureMcp?: boolean;
  rootIndex?: boolean;
}

export interface InitResult {
  vaultDir: string;
  createdFiles: string[];
  updatedFiles: string[];
  skippedFiles: string[];
  configuredAgents: AgentTarget[];
  configuredMcp: string[];
}

export const INDEX_MARKER_START = '<!-- LLMWIKI_INDEX_START -->';
export const INDEX_MARKER_END = '<!-- LLMWIKI_INDEX_END -->';

export async function initVault(options: InitOptions): Promise<InitResult> {
  const vaultDir = path.resolve(options.vaultDir);
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  // 1. Create required directories
  const directories = [
    path.join(vaultDir, 'raw'),
    path.join(vaultDir, 'wiki', 'entities'),
    path.join(vaultDir, 'wiki', 'concepts'),
    path.join(vaultDir, 'wiki', 'syntheses'),
  ];

  for (const dir of directories) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Helper to safely write a file if it doesn't already exist
  const maybeCreateFile = async (relativePath: string, content: string) => {
    const fullPath = path.join(vaultDir, relativePath);
    try {
      await fs.access(fullPath);
      // File already exists
      if (!options.force) {
        skippedFiles.push(relativePath);
        return;
      }
    } catch {
      // File does not exist, proceed
    }

    await atomicWriteFile(fullPath, content);
    createdFiles.push(relativePath);
  };

  const today = new Date().toISOString().slice(0, 10);

  // 2. Default index.md
  const defaultIndex = `# Wiki Index

Welcome to your LLM Wiki. This index is maintained automatically by \`llmwiki\` and compiled by AI agents.

${INDEX_MARKER_START}
## Concepts

_No concepts indexed yet._

## Entities

_No entities indexed yet._

## Syntheses

_No syntheses indexed yet._
${INDEX_MARKER_END}
`;

  const indexRelPath = options.rootIndex ? 'index.md' : path.join('wiki', 'index.md');
  const logRelPath = options.rootIndex ? 'log.md' : path.join('wiki', 'log.md');

  // 3. Default log.md
  const defaultLog = `# Wiki Log

Append-only chronological audit trail of all knowledge base operations.

## [${today}] init | Vault initialized
- Scaffolded directory structure (\`raw/\`, \`wiki/entities/\`, \`wiki/concepts/\`, \`wiki/syntheses/\`)
- Generated ${indexRelPath.replace(/\\/g, '/')}, ${logRelPath.replace(/\\/g, '/')}, and agent configurations
`;

  // 4. Resolve target agents
  const targets: AgentTarget[] = options.allAgents
    ? ALL_AGENTS
    : options.agents && options.agents.length > 0
    ? options.agents
    : await detectAgentEnvironments(vaultDir);

  await maybeCreateFile(indexRelPath, defaultIndex);
  await maybeCreateFile(logRelPath, defaultLog);

  // Configure agent rules
  const rulesResult = await configureAgentRules(vaultDir, targets);
  createdFiles.push(...rulesResult.created);
  const updatedFiles = [...rulesResult.updated];
  skippedFiles.push(...rulesResult.skipped);

  // Configure agent MCP configs
  let configuredMcp: string[] = [];
  if (options.configureMcp !== false) {
    configuredMcp = await configureAgentMcp(vaultDir, targets);
  }

  return {
    vaultDir,
    createdFiles,
    updatedFiles,
    skippedFiles,
    configuredAgents: targets,
    configuredMcp,
  };
}
