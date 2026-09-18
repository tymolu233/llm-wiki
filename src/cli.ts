import * as path from 'node:path';
import * as p from '@clack/prompts';
import { initVault } from './core/init.js';
import { lintVault, formatLintReport } from './core/linter.js';
import { reconcileIndex } from './core/indexer.js';
import { searchVault } from './core/search.js';
import { startMcpServer } from './mcp/server.js';
import { ALL_AGENT_INFOS, ALL_AGENTS, AgentTarget, detectAgentEnvironments } from './core/agents.js';

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  if (command === '--version' || command === '-v') {
    console.log('llmwiki v0.1.0');
    return 0;
  }

  switch (command) {
    case 'init': {
      let targetDirArg: string | undefined;
      let isAll = false;
      let isYes = false;
      let noMcp = false;
      let force = false;
      let agentList: AgentTarget[] | undefined;

      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--all') {
          isAll = true;
        } else if (arg === '-y' || arg === '--yes') {
          isYes = true;
        } else if (arg === '--no-mcp') {
          noMcp = true;
        } else if (arg === '--force' || arg === '-f') {
          force = true;
        } else if (arg === '--agent' || arg === '-a') {
          const next = args[++i];
          if (next) {
            agentList = next.split(',').map((s) => s.trim().toLowerCase()) as AgentTarget[];
          }
        } else if (arg.startsWith('--agent=')) {
          agentList = arg.slice('--agent='.length).split(',').map((s) => s.trim().toLowerCase()) as AgentTarget[];
        } else if (!arg.startsWith('-') && !targetDirArg) {
          targetDirArg = arg;
        }
      }

      if (agentList) {
        const validSet = new Set<AgentTarget>(ALL_AGENTS);
        const invalid = agentList.filter((a) => !validSet.has(a));
        if (invalid.length > 0) {
          console.error(`❌ Unknown agent target(s): ${invalid.join(', ')}`);
          console.error(`   Available agents: ${ALL_AGENTS.join(', ')}`);
          return 1;
        }
      }

      const targetDir = targetDirArg ? path.resolve(targetDirArg) : process.cwd();
      const canPrompt = Boolean(process.stdout.isTTY) && !isYes && !isAll && !agentList;

      if (canPrompt) {
        p.intro('📚 llmwiki init — Agent-First Knowledge Base');

        const detected = await detectAgentEnvironments(targetDir);

        const selectedAgents = (await p.multiselect({
          message: 'Select AI agents to configure with LLM Wiki rules:',
          options: ALL_AGENT_INFOS.map((info) => ({
            value: info.id,
            label: info.name,
            hint: info.description,
          })),
          initialValues: detected,
          required: false,
        })) as AgentTarget[] | symbol;

        if (p.isCancel(selectedAgents)) {
          p.cancel('Initialization cancelled.');
          return 0;
        }

        let setupMcp = !noMcp;
        if (!noMcp) {
          const confirmMcp = await p.confirm({
            message: 'Configure project-level MCP server for selected agents?',
            initialValue: true,
          });

          if (p.isCancel(confirmMcp)) {
            p.cancel('Initialization cancelled.');
            return 0;
          }
          setupMcp = Boolean(confirmMcp);
        }

        const s = p.spinner();
        s.start('Scaffolding vault and configuring agent rules...');

        try {
          const result = await initVault({
            vaultDir: targetDir,
            force,
            agents: selectedAgents as AgentTarget[],
            configureMcp: setupMcp,
          });

          s.stop('LLM Wiki vault initialized!');

          const lines: string[] = [];
          for (const file of result.createdFiles) {
            lines.push(`  + Created: ${file}`);
          }
          for (const file of result.updatedFiles) {
            lines.push(`  * Appended rule: ${file} (safely preserved existing content)`);
          }
          for (const file of result.skippedFiles) {
            lines.push(`  - Skipped: ${file} (already contains rules)`);
          }
          if (result.configuredMcp.length > 0) {
            lines.push('');
            for (const mcpFile of result.configuredMcp) {
              lines.push(`  🔌 MCP Configured: ${mcpFile}`);
            }
          }

          p.note(lines.join('\n'), 'Vault Configuration Summary');
          p.outro('✨ Knowledge base ready! Open this directory in Obsidian or your AI assistant.');
          return 0;
        } catch (err: any) {
          s.stop('Initialization failed.');
          p.log.error(err.message);
          return 1;
        }
      } else {
        console.log(`\n📦 Initializing LLM Wiki vault in: ${targetDir}\n`);

        try {
          const result = await initVault({
            vaultDir: targetDir,
            force,
            agents: agentList,
            allAgents: isAll,
            configureMcp: !noMcp,
          });

          for (const file of result.createdFiles) {
            console.log(`  ✓ Created: ${file}`);
          }
          for (const file of result.updatedFiles) {
            console.log(`  ✓ Updated: ${file} (appended rules non-destructively)`);
          }
          for (const file of result.skippedFiles) {
            console.log(`  - Exists:  ${file} (skipped)`);
          }
          if (result.configuredMcp.length > 0) {
            for (const mcpFile of result.configuredMcp) {
              console.log(`  🔌 MCP:     ${mcpFile}`);
            }
          }
          console.log(`\n✨ Knowledge base ready! Open this directory in Obsidian or your favorite editor.\n`);
          return 0;
        } catch (err: any) {
          console.error(`❌ Initialization failed: ${err.message}`);
          return 1;
        }
      }
    }

    case 'lint': {
      const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
      try {
        const report = await lintVault(targetDir);
        console.log(formatLintReport(report));
        const errors = report.issues.filter((i) => i.severity === 'error');
        return errors.length > 0 ? 1 : 0;
      } catch (err: any) {
        console.error(`❌ Lint failed: ${err.message}`);
        return 1;
      }
    }

    case 'index': {
      const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
      try {
        const stats = await reconcileIndex(targetDir);
        console.log(`\n📚 Index reconciled for: ${targetDir}`);
        console.log(`   • Total notes:     ${stats.totalNotes}`);
        console.log(`   • Concepts:        ${stats.conceptCount}`);
        console.log(`   • Entities:        ${stats.entityCount}`);
        console.log(`   • Syntheses:       ${stats.synthesisCount}`);
        console.log(`   • Status:          ${stats.updated ? 'Updated index.md' : 'Up to date (no changes)'}\n`);
        return 0;
      } catch (err: any) {
        console.error(`❌ Index reconciliation failed: ${err.message}`);
        return 1;
      }
    }

    case 'search': {
      const query = args[1];
      if (!query || query.startsWith('--')) {
        console.error('❌ Please provide a search query: npx llmwiki search <query>');
        return 1;
      }

      const isJson = args.includes('--json');
      const targetDir = args[2] && !args[2].startsWith('--') ? path.resolve(args[2]) : process.cwd();

      try {
        const results = await searchVault(targetDir, query);
        if (isJson) {
          console.log(JSON.stringify(results, null, 2));
          return 0;
        }

        console.log(`\n🔎 Search results for "${query}" (${results.length} found):\n`);
        if (results.length === 0) {
          console.log('  No matching notes found.\n');
          return 0;
        }

        for (const res of results) {
          console.log(`  📄 [[${res.title}]] (${res.relativePath})`);
          console.log(`     Score: ${res.score} | Type: ${res.type}`);
          console.log(`     "${res.snippet}"\n`);
        }
        return 0;
      } catch (err: any) {
        console.error(`❌ Search failed: ${err.message}`);
        return 1;
      }
    }

    case 'mcp': {
      const targetDir = args[1] && !args[1].startsWith('--') ? path.resolve(args[1]) : process.cwd();
      try {
        await startMcpServer(targetDir);
        return 0;
      } catch (err: any) {
        console.error(`❌ Failed to start MCP server: ${err.message}`);
        return 1;
      }
    }

    default: {
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
    }
  }
}

function printHelp() {
  console.log(`
llmwiki - Agent-First personal knowledge base engine

Usage:
  npx llmwiki <command> [options]

Commands:
  init [path]     Scaffold a new LLM Wiki vault and adapt agent rules (defaults to cwd)
  index [path]    Reconcile and rebuild index.md from all notes
  lint [path]     Audit knowledge base for broken links and orphan notes
  search <query>  Search vault notes for keywords or phrases
  mcp             Start the Model Context Protocol stdio server

Options for 'init':
  -y, --yes             Skip prompts and initialize with detected defaults
  --all                 Configure rules and MCP for all supported agents
  -a, --agent <agents>  Comma-separated list (cursor,claude,agents,cline,copilot,windsurf,gemini,zed)
  --no-mcp              Skip MCP server configuration
  -f, --force           Overwrite default index.md and log.md if already present

Global Options:
  -h, --help      Show this help message
  -v, --version   Show version number
`);
}
