import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { initVault } from '../src/core/init.js';
import { resolveLogPath } from '../src/core/storage.js';

/**
 * Extracts the text from the first content block of an MCP tool call result.
 * `client.callTool` resolves to the compatibility result union where the
 * legacy branch carries `toolResult` instead of `content`, so the shape is
 * discriminated explicitly instead of relying on `as any` casts.
 */
function firstText(result: unknown): string {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('Expected tool result to contain a content field');
  }
  const { content } = result;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error('Expected tool result to contain at least one content block');
  }
  const block: unknown = content[0];
  if (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'text' &&
    'text' in block &&
    typeof block.text === 'string'
  ) {
    return block.text;
  }
  throw new Error('Expected first content block of tool result to be a text block');
}

describe('MCP Server Module', () => {
  let tempDir: string;
  let client: Client;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-mcp-test-'));
    await initVault({ vaultDir: tempDir });

    const server = createMcpServer(tempDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('lists all 7 atomic wiki tools', async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).toContain('wiki_read_index');
    expect(toolNames).toContain('wiki_read_note');
    expect(toolNames).toContain('wiki_write_note');
    expect(toolNames).toContain('wiki_search');
    expect(toolNames).toContain('wiki_append_log');
    expect(toolNames).toContain('wiki_lint');
    expect(toolNames).toContain('wiki_status');
  });

  it('performs write_note, read_note, and read_index through MCP', async () => {
    // 1. Write Note
    const writeRes = await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'Distributed Consensus',
        content: '# Distributed Consensus\nAchieving agreement in unreliable networks.',
        frontmatter: {
          summary: 'Consensus in distributed systems',
          tags: ['systems', 'distributed'],
        },
      },
    });

    expect(writeRes.isError).toBeFalsy();
    const writeText = firstText(writeRes);
    expect(writeText).toContain('Distributed Consensus');

    // 2. Read Note
    const readRes = await client.callTool({
      name: 'wiki_read_note',
      arguments: {
        pathOrTitle: 'Distributed Consensus',
      },
    });

    const readText = firstText(readRes);
    expect(readText).toContain('Achieving agreement');

    // 3. Read Index (should contain the newly written note)
    const indexRes = await client.callTool({
      name: 'wiki_read_index',
      arguments: {},
    });

    const indexText = firstText(indexRes);
    expect(indexText).toContain('[[Distributed Consensus]]');
  });

  it('searches, logs, and lints through MCP', async () => {
    // 1. Write a note to search for
    await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'Byzantine Fault Tolerance',
        content: '# Byzantine Fault Tolerance\nDefends against arbitrary failures.',
      },
    });

    // 2. Search
    const searchRes = await client.callTool({
      name: 'wiki_search',
      arguments: {
        query: 'Byzantine',
      },
    });
    const searchText = firstText(searchRes);
    expect(searchText).toContain('Byzantine Fault Tolerance');

    // 3. Append Log
    const logRes = await client.callTool({
      name: 'wiki_append_log',
      arguments: {
        operation: 'ingest',
        title: 'BFT Research Paper',
        details: ['Extracted BFT definition', 'Linked consensus terms'],
      },
    });
    expect(logRes.isError).toBeFalsy();

    const logPath = await resolveLogPath(tempDir);
    const logFile = await fs.readFile(logPath, 'utf-8');
    expect(logFile).toContain('BFT Research Paper');
    expect(logFile).toContain('- Extracted BFT definition');

    // 4. Lint
    const lintRes = await client.callTool({
      name: 'wiki_lint',
      arguments: {},
    });
    const lintText = firstText(lintRes);
    expect(lintText).toContain('Health Check');

    // 5. Status
    const statusRes = await client.callTool({
      name: 'wiki_status',
      arguments: {},
    });
    const statusData = JSON.parse(firstText(statusRes));
    expect(statusData.notes.total).toBe(1);
    expect(statusData.notes.concepts).toBe(1);
  });

  it('merges canonical frontmatter into content that already has frontmatter', async () => {
    await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'Merged Note',
        content: '---\ncustom_field: keep-me\n---\n# Merged Note\nBody.',
      },
    });

    const raw = await fs.readFile(path.join(tempDir, 'wiki', 'concepts', 'Merged Note.md'), 'utf-8');
    expect(raw).toContain('custom_field: keep-me');
    expect(raw).toContain('title: Merged Note');
    expect(raw).toContain('type: concept');
    expect(raw).toContain('last_updated:');
  });

  it('skipReconcile defers index rebuild during batch writes', async () => {
    const writeRes = await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'Batch Note',
        content: '# Batch Note\nWritten without reconcile.',
        skipReconcile: true,
      },
    });
    expect(firstText(writeRes)).toContain('skipped');

    // Index should NOT contain the note yet
    const indexRes = await client.callTool({ name: 'wiki_read_index', arguments: {} });
    expect(firstText(indexRes)).not.toContain('[[Batch Note]]');
  });

  it('provides bidirectional graph relationships (links and backlinks with fromTitle) via wiki_read_note', async () => {
    // 1. Create target note A
    await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'Target Hub',
        content: '# Target Hub\nCore hub.',
      },
    });

    // 2. Create note B that links to A
    await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'Source Concept',
        content: '# Source Concept\nDepends on [[Target Hub]].',
      },
    });

    // 3. Read target note A to verify backlinks
    const readA = await client.callTool({
      name: 'wiki_read_note',
      arguments: {
        pathOrTitle: 'Target Hub',
      },
    });

    const parsedA = JSON.parse(firstText(readA));
    expect(parsedA.backlinks).toBeDefined();
    expect(parsedA.backlinks.length).toBe(1);
    expect(parsedA.backlinks[0].fromTitle).toBe('Source Concept');
    expect(parsedA.backlinks[0].linkText).toContain('Target Hub');
  });

  it('reports the package version dynamically instead of a hardcoded one', async () => {
    const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8'));
    const serverVersion = client.getServerVersion();
    expect(serverVersion?.name).toBe('llmwiki-mcp');
    expect(serverVersion?.version).toBe(pkg.version);
  });

  it('prefixes Windows reserved device names (e.g. CON) with an underscore', async () => {
    const writeRes = await client.callTool({
      name: 'wiki_write_note',
      arguments: {
        category: 'concepts',
        title: 'CON',
        content: '# CON\nReserved device name test.',
      },
    });
    expect(writeRes.isError).toBeFalsy();

    const stat = await fs.stat(path.join(tempDir, 'wiki', 'concepts', '_CON.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('serializes concurrent wiki_append_log calls without losing entries', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.callTool({
          name: 'wiki_append_log',
          arguments: {
            operation: 'ingest',
            title: `Concurrent Entry ${i}`,
          },
        })
      )
    );

    const logPath = await resolveLogPath(tempDir);
    const logFile = await fs.readFile(logPath, 'utf-8');
    const headerCount = (logFile.match(/^## \[/gm) || []).length;
    // 1 init entry + 10 concurrent appends, none lost
    expect(headerCount).toBe(11);
    for (let i = 0; i < 10; i++) {
      expect(logFile).toContain(`Concurrent Entry ${i}`);
    }
  });

  it('wiki_read_index returns freshly reconciled content in root-index vaults with a missing index', async () => {
    const rootVault = await fs.mkdtemp(path.join(os.tmpdir(), 'llmwiki-mcp-rootidx-'));
    try {
      await initVault({ vaultDir: rootVault, rootIndex: true });
      // Simulate a deleted index: nothing at wiki/index.md or vault root
      await fs.rm(path.join(rootVault, 'index.md'));

      const rootServer = createMcpServer(rootVault);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await rootServer.connect(serverTransport);
      const rootClient = new Client({ name: 'test-client-rootidx', version: '1.0.0' }, { capabilities: {} });
      await rootClient.connect(clientTransport);

      try {
        const res = await rootClient.callTool({ name: 'wiki_read_index', arguments: {} });
        expect(res.isError).toBeFalsy();
        const text = firstText(res);
        expect(text).toContain('# Wiki Index');
      } finally {
        await rootClient.close();
        await rootServer.close();
      }
    } finally {
      await fs.rm(rootVault, { recursive: true, force: true });
    }
  });
});
