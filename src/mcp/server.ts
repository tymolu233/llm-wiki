import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';
import { atomicWriteFile, assertPathContained, safeReadFile } from '../core/storage.js';
import { reconcileIndex } from '../core/indexer.js';
import { searchVault } from '../core/search.js';
import { lintVault, formatLintReport } from '../core/linter.js';
import { buildVaultGraph } from '../core/graph.js';

export function createMcpServer(vaultDir: string): McpServer {
  const server = new McpServer({
    name: 'llmwiki-mcp',
    version: '0.1.0',
  });

  // 1. wiki_read_index
  server.tool(
    'wiki_read_index',
    'Read the catalog index of the wiki, summarizing concepts, entities, and syntheses with backlink counts.',
    {},
    async () => {
      const indexPath = path.join(vaultDir, 'index.md');
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        return {
          content: [{ type: 'text', text: content }],
        };
      } catch {
        // If index doesn't exist, reconcile it first
        await reconcileIndex(vaultDir);
        const content = await fs.readFile(indexPath, 'utf-8');
        return {
          content: [{ type: 'text', text: content }],
        };
      }
    }
  );

  // 2. wiki_read_note
  server.tool(
    'wiki_read_note',
    'Read a specific wiki note by title, alias, or relative path. Returns frontmatter, body, and outbound links.',
    {
      pathOrTitle: z.string().describe("Note title, alias, or relative path (e.g. 'Distributed Consensus' or 'wiki/concepts/raft.md')"),
    },
    async ({ pathOrTitle }) => {
      const graph = await buildVaultGraph(vaultDir);
      const clean = pathOrTitle.trim().replace(/\.md$/, '');

      let targetNode = graph.notes.get(pathOrTitle) || graph.notes.get(`${clean}.md`);

      if (!targetNode) {
        for (const node of graph.notes.values()) {
          const basename = path.basename(node.note.relativePath, '.md');
          if (
            basename === clean ||
            node.note.title === clean ||
            node.note.aliases.includes(clean) ||
            basename.toLowerCase() === clean.toLowerCase() ||
            node.note.title.toLowerCase() === clean.toLowerCase()
          ) {
            targetNode = node;
            break;
          }
        }
      }

      if (!targetNode) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Note not found for identifier: "${pathOrTitle}"` }],
        };
      }

      const rawContent = await safeReadFile(vaultDir, targetNode.note.relativePath);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                relativePath: targetNode.note.relativePath,
                title: targetNode.note.title,
                type: targetNode.note.type,
                aliases: targetNode.note.aliases,
                tags: targetNode.note.tags,
                sources: targetNode.note.sources,
                frontmatter: targetNode.note.frontmatter,
                links: targetNode.note.links,
                rawMarkdown: rawContent,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 3. wiki_write_note
  server.tool(
    'wiki_write_note',
    'Create or update a wiki note under entities, concepts, or syntheses with atomic safety and automatic index updating.',
    {
      category: z.enum(['entities', 'concepts', 'syntheses']).describe('Category subfolder under wiki/'),
      title: z.string().describe("Note title (e.g. 'Distributed Consensus')"),
      content: z.string().describe('Markdown content of the note. Should link other notes using [[wikilinks]].'),
      frontmatter: z
        .object({
          aliases: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          sources: z.array(z.string()).optional(),
          summary: z.string().optional(),
        })
        .optional()
        .describe('Optional frontmatter properties'),
    },
    async ({ category, title, content, frontmatter }) => {
      // Sanitize filename
      const safeFilename = title.trim().replace(/[\\/:*?"<>|]/g, '-');
      const relativePath = path.join('wiki', category, `${safeFilename}.md`);
      const targetPath = assertPathContained(vaultDir, relativePath);

      const today = new Date().toISOString().slice(0, 10);
      const fmData: Record<string, any> = {
        title: title.trim(),
        type: category === 'entities' ? 'entity' : category === 'concepts' ? 'concept' : 'synthesis',
        aliases: frontmatter?.aliases || [],
        tags: frontmatter?.tags || [],
        sources: frontmatter?.sources || [],
        last_updated: today,
      };

      if (frontmatter?.summary) {
        fmData.summary = frontmatter.summary;
      }

      // Check if body already has frontmatter
      let finalMarkdown = '';
      if (content.trim().startsWith('---')) {
        finalMarkdown = content;
      } else {
        finalMarkdown = matter.stringify(content, fmData);
      }

      await atomicWriteFile(targetPath, finalMarkdown);

      // Automatically keep index.md fresh
      await reconcileIndex(vaultDir);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully wrote note: [[${title.trim()}]] to ${relativePath.replace(/\\/g, '/')}\nIndex reconciled automatically.`,
          },
        ],
      };
    }
  );

  // 4. wiki_search
  server.tool(
    'wiki_search',
    'Search vault notes for keywords or phrases with relevance scoring and snippet previews.',
    {
      query: z.string().describe('Search term or phrase'),
      limit: z.number().optional().describe('Maximum results to return (default: 10)'),
    },
    async ({ query, limit }) => {
      const results = await searchVault(vaultDir, query, { limit });
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // 5. wiki_append_log
  server.tool(
    'wiki_append_log',
    'Append a timestamped record of an operation to log.md (e.g. ingesting a source, synthesizing research).',
    {
      operation: z.string().describe("Operation verb (e.g. 'ingest', 'query', 'lint', 'refactor')"),
      title: z.string().describe('Short title summarizing the operation'),
      details: z.array(z.string()).optional().describe('List of bullet points detailing changes made'),
    },
    async ({ operation, title, details }) => {
      const logPath = path.join(vaultDir, 'log.md');
      const today = new Date().toISOString().slice(0, 10);

      let logEntry = `\n## [${today}] ${operation.trim()} | ${title.trim()}\n`;
      if (details && details.length > 0) {
        for (const detail of details) {
          logEntry += `- ${detail.trim()}\n`;
        }
      }

      let existingLog = '';
      try {
        existingLog = await fs.readFile(logPath, 'utf-8');
      } catch {
        existingLog = '# Wiki Log\n\nAppend-only chronological audit trail.\n';
      }

      const updatedLog = `${existingLog.trimEnd()}\n${logEntry}`;
      await atomicWriteFile(logPath, updatedLog);

      return {
        content: [{ type: 'text', text: `Appended log entry: ## [${today}] ${operation.trim()} | ${title.trim()}` }],
      };
    }
  );

  // 6. wiki_lint
  server.tool(
    'wiki_lint',
    'Audit the vault for broken links (dead references), orphan notes, and case-sensitivity mismatches.',
    {},
    async () => {
      const report = await lintVault(vaultDir);
      return {
        content: [{ type: 'text', text: formatLintReport(report) }],
      };
    }
  );

  return server;
}

/**
 * Starts the MCP Server over stdio transport.
 */
export async function startMcpServer(vaultDir: string): Promise<void> {
  const server = createMcpServer(vaultDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
