import * as fs from 'node:fs';
import * as path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { initVault } from './core/init.js';
import { lintVault, formatLintReport } from './core/linter.js';
import { reconcileIndex } from './core/indexer.js';
import { searchVault } from './core/search.js';
import { getVaultStatus, formatVaultStatus } from './core/status.js';
import { startMcpServer } from './mcp/server.js';
import { ALL_AGENT_INFOS, ALL_AGENTS, AgentTarget, detectAgentEnvironments } from './core/agents.js';
import { findVaultRoot } from './core/storage.js';

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function renderBanner(): void {
  const banner = [
    pc.cyan('██╗     ██╗     ███╗   ███╗██╗    ██╗██╗██╗  ██╗██╗'),
    pc.cyanBright('██║     ██║     ████╗ ████║██║    ██║██║██║ ██╔╝██║'),
    pc.blueBright('██║     ██║     ██╔████╔██║██║ █╗ ██║██║█████╔╝ ██║'),
    pc.blue('██║     ██║     ██║╚██╔╝██║██║███╗██║██║██╔═██╗ ██║'),
    pc.magentaBright('███████╗███████╗██║ ╚═╝ ██║╚███╔███╔╝██║██║  ██╗██║'),
    pc.magenta('╚══════╝╚══════╝╚═╝     ╚═╝ ╚══╝╚══╝ ╚═╝╚═╝  ╚═╝╚═╝'),
  ];
  console.log('\n' + banner.join('\n'));
  console.log('  ' + pc.bold(pc.cyan('LLMWIKI')) + pc.dim(' - Agent-First Knowledge Base Engine'));
  console.log(pc.dim('     "Stop Retrieving, Start Compiling."\n'));
}

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  if (command === '--version' || command === '-v') {
    console.log(`llmwiki v${getPackageVersion()}`);
    return 0;
  }

  switch (command) {
    case 'init': {
      let targetDirArg: string | undefined;
      let isAll = false;
      let isYes = false;
      let noMcp = false;
      let force = false;
      let rootIndex = false;
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
        } else if (arg === '--root-index') {
          rootIndex = true;
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
          console.error(pc.red(`Error: Unknown agent target(s): ${invalid.join(', ')}`));
          console.error(`Available agents: ${ALL_AGENTS.join(', ')}`);
          return 1;
        }
      }

      const targetDir = targetDirArg ? path.resolve(targetDirArg) : process.cwd();
      const canPrompt = Boolean(process.stdout.isTTY) && !isYes && !isAll && !agentList;

      if (canPrompt) {
        renderBanner();

        p.intro(pc.bgCyan(pc.black(' llmwiki init ')) + ' ' + pc.bold('Agent-First Knowledge Base Setup'));

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

        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const s = p.spinner();

        s.start(pc.cyan('Connecting to vault matrix...'));
        await sleep(150);

        s.message(pc.cyan('Scaffolding taxonomy (raw/, wiki/concepts, entities, syntheses)...'));
        await sleep(150);

        s.message(pc.cyan('Synthesizing indexed catalog and append-only audit log...'));
        await sleep(150);

        const selectedList = selectedAgents as AgentTarget[];
        if (selectedList.length > 0) {
          s.message(pc.cyan(`Configuring Librarian protocols for: ${selectedList.join(', ')}...`));
          await sleep(180);
        }

        if (setupMcp) {
          s.message(pc.cyan('Binding Model Context Protocol (MCP) server endpoints...'));
          await sleep(150);
        }

        try {
          const result = await initVault({
            vaultDir: targetDir,
            force,
            agents: selectedList,
            configureMcp: setupMcp,
            rootIndex,
          });

          s.stop(pc.green('Vault initialized and agent protocols configured!'));

          const lines: string[] = [];
          lines.push(pc.bold('Vault Location: ') + pc.cyan(targetDir));
          lines.push('');
          lines.push(pc.bold('Scaffolding & Notes:'));
          for (const file of result.createdFiles) {
            lines.push(`   ${pc.green('+')} Created:  ${pc.white(file)}`);
          }
          for (const file of result.updatedFiles) {
            lines.push(`   ${pc.yellow('*')} Appended: ${pc.yellow(file)} ${pc.dim('(safely preserved user content)')}`);
          }
          for (const file of result.skippedFiles) {
            lines.push(`   ${pc.dim('-')} Skipped:  ${pc.dim(file)} ${pc.dim('(already configured)')}`);
          }
          if (result.configuredMcp.length > 0) {
            lines.push('');
            lines.push(pc.bold('Agent MCP Integrations:'));
            for (const mcpFile of result.configuredMcp) {
              lines.push(`   ${pc.magenta('>')} MCP:      ${pc.magenta(mcpFile)} ${pc.dim('(stdio server configured)')}`);
            }
          }

          p.note(lines.join('\n'), 'Vault Configuration Summary');
          p.outro(pc.green('LLM Wiki is ready! Open in Obsidian or have your AI agent compile notes.'));
          return 0;
        } catch (err: any) {
          s.stop(pc.red('Initialization failed.'));
          p.log.error(err.message);
          return 1;
        }
      } else {
        if (process.stdout.isTTY) {
          renderBanner();
        }
        console.log(`\nInitializing LLM Wiki vault in: ${targetDir}\n`);

        try {
          const result = await initVault({
            vaultDir: targetDir,
            force,
            agents: agentList,
            allAgents: isAll,
            configureMcp: !noMcp,
            rootIndex,
          });

          for (const file of result.createdFiles) {
            console.log(`  ${pc.green('+')} Created:  ${file}`);
          }
          for (const file of result.updatedFiles) {
            console.log(`  ${pc.yellow('*')} Appended: ${file} ${pc.dim('(rules non-destructively added)')}`);
          }
          for (const file of result.skippedFiles) {
            console.log(`  ${pc.dim('-')} Exists:   ${file} ${pc.dim('(skipped)')}`);
          }
          if (result.configuredMcp.length > 0) {
            for (const mcpFile of result.configuredMcp) {
              console.log(`  ${pc.cyan('>')} MCP:      ${mcpFile}`);
            }
          }
          console.log(`\nKnowledge base ready! Open this directory in Obsidian or your favorite editor.\n`);
          return 0;
        } catch (err: any) {
          console.error(pc.red(`Error: Initialization failed - ${err.message}`));
          return 1;
        }
      }
    }

    case 'status': {
      const isJson = args.includes('--json');
      const targetDirArg = args.find((a) => !a.startsWith('--') && a !== 'status');
      const targetDir = await findVaultRoot(targetDirArg ? path.resolve(targetDirArg) : process.cwd());

      try {
        const status = await getVaultStatus(targetDir);
        if (isJson) {
          console.log(JSON.stringify(status, null, 2));
          return 0;
        }
        console.log(formatVaultStatus(status));
        return 0;
      } catch (err: any) {
        console.error(pc.red(`Error: Failed to get vault status - ${err.message}`));
        return 1;
      }
    }

    case 'lint': {
      const rawTarget = args[1] ? path.resolve(args[1]) : process.cwd();
      const targetDir = await findVaultRoot(rawTarget);
      try {
        const report = await lintVault(targetDir);
        console.log(formatLintReport(report));
        const errors = report.issues.filter((i) => i.severity === 'error');
        return errors.length > 0 ? 1 : 0;
      } catch (err: any) {
        console.error(pc.red(`Error: Lint failed - ${err.message}`));
        return 1;
      }
    }

    case 'index': {
      const rawTarget = args[1] ? path.resolve(args[1]) : process.cwd();
      const targetDir = await findVaultRoot(rawTarget);
      try {
        const stats = await reconcileIndex(targetDir);
        console.log(`\nIndex reconciled for: ${targetDir}`);
        console.log(`   - Total notes:     ${stats.totalNotes}`);
        console.log(`   - Concepts:        ${stats.conceptCount}`);
        console.log(`   - Entities:        ${stats.entityCount}`);
        console.log(`   - Syntheses:       ${stats.synthesisCount}`);
        console.log(`   - Status:          ${stats.updated ? 'Updated index.md' : 'Up to date (no changes)'}\n`);
        return 0;
      } catch (err: any) {
        console.error(pc.red(`Error: Index reconciliation failed - ${err.message}`));
        return 1;
      }
    }

    case 'search': {
      const query = args[1];
      if (!query || query.startsWith('--')) {
        console.error(pc.red('Error: Please provide a search query: npx @tymolu/llmwiki search <query>'));
        return 1;
      }

      const isJson = args.includes('--json');
      const rawTarget = args[2] && !args[2].startsWith('--') ? path.resolve(args[2]) : process.cwd();
      const targetDir = await findVaultRoot(rawTarget);

      try {
        const results = await searchVault(targetDir, query);
        if (isJson) {
          console.log(JSON.stringify(results, null, 2));
          return 0;
        }

        console.log(`\nSearch results for "${query}" (${results.length} found):\n`);
        if (results.length === 0) {
          console.log('  No matching notes found.\n');
          return 0;
        }

        for (const res of results) {
          console.log(`  [[${res.title}]] (${res.relativePath})`);
          console.log(`     Score: ${res.score} | Type: ${res.type}`);
          console.log(`     "${res.snippet}"\n`);
        }
        return 0;
      } catch (err: any) {
        console.error(pc.red(`Error: Search failed - ${err.message}`));
        return 1;
      }
    }

    case 'mcp': {
      const rawTarget = args[1] && !args[1].startsWith('--') ? path.resolve(args[1]) : process.cwd();
      const targetDir = await findVaultRoot(rawTarget);
      try {
        await startMcpServer(targetDir);
        return 0;
      } catch (err: any) {
        console.error(pc.red(`Error: Failed to start MCP server - ${err.message}`));
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
  npx @tymolu/llmwiki <command> [options]

Commands:
  init [path]     Scaffold a new LLM Wiki vault and adapt agent rules (defaults to cwd)
  status [path]   Display vault overview, graph hubs, and pending raw compilation sources
  index [path]    Reconcile and rebuild index.md from all notes
  lint [path]     Audit knowledge base for broken links and orphan notes
  search <query>  Search vault notes for keywords or phrases
  mcp             Start the Model Context Protocol stdio server

Options for 'init':
  -y, --yes             Skip prompts and initialize with detected defaults
  --all                 Configure rules and MCP for all supported agents
  -a, --agent <agents>  Comma-separated list (cursor,claude,agents,cline,copilot,windsurf,gemini,zed,continue)
  --no-mcp              Skip MCP server configuration
  --root-index          Place index.md and log.md in vault root instead of wiki/
  -f, --force           Overwrite default index.md and log.md if already present

Global Options:
  -h, --help      Show this help message
  -v, --version   Show version number
`);
}
