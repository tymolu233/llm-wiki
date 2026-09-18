import * as path from 'node:path';
import { initVault } from './core/init.js';
import { lintVault, formatLintReport } from './core/linter.js';
import { reconcileIndex } from './core/indexer.js';
import { searchVault } from './core/search.js';

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
      const targetDir = args[1] ? path.resolve(args[1]) : process.cwd();
      console.log(`\n📦 Initializing LLM Wiki vault in: ${targetDir}\n`);

      try {
        const result = await initVault({ vaultDir: targetDir });
        for (const file of result.createdFiles) {
          console.log(`  ✓ Created: ${file}`);
        }
        for (const file of result.skippedFiles) {
          console.log(`  - Exists:  ${file} (skipped)`);
        }
        console.log(`\n✨ Knowledge base ready! Open this directory in Obsidian or your favorite editor.\n`);
        return 0;
      } catch (err: any) {
        console.error(`❌ Initialization failed: ${err.message}`);
        return 1;
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
      console.log(`Command "${command}" will be implemented in subsequent tickets.`);
      return 0;
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
  init [path]     Scaffold a new LLM Wiki vault in the specified directory (defaults to cwd)
  index [path]    Reconcile and rebuild index.md from all notes
  lint [path]     Audit knowledge base for broken links and orphan notes
  search <query>  Search vault notes for keywords or phrases
  mcp             Start the Model Context Protocol stdio server

Options:
  -h, --help      Show this help message
  -v, --version   Show version number
`);
}
