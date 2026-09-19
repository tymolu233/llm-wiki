import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { initVault } from '../src/core/init.js';
import { resolveLogPath } from '../src/core/storage.js';

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
    const writeText = (writeRes.content[0] as any).text;
    expect(writeText).toContain('Distributed Consensus');

    // 2. Read Note
    const readRes = await client.callTool({
      name: 'wiki_read_note',
      arguments: {
        pathOrTitle: 'Distributed Consensus',
      },
    });

    const readText = (readRes.content[0] as any).text;
    expect(readText).toContain('Achieving agreement');

    // 3. Read Index (should contain the newly written note)
    const indexRes = await client.callTool({
      name: 'wiki_read_index',
      arguments: {},
    });

    const indexText = (indexRes.content[0] as any).text;
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
    const searchText = (searchRes.content[0] as any).text;
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
    const lintText = (lintRes.content[0] as any).text;
    expect(lintText).toContain('Health Check');

    // 5. Status
    const statusRes = await client.callTool({
      name: 'wiki_status',
      arguments: {},
    });
    const statusData = JSON.parse((statusRes.content[0] as any).text);
    expect(statusData.notes.total).toBe(1);
    expect(statusData.notes.concepts).toBe(1);
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

    const parsedA = JSON.parse((readA.content[0] as any).text);
    expect(parsedA.backlinks).toBeDefined();
    expect(parsedA.backlinks.length).toBe(1);
    expect(parsedA.backlinks[0].fromTitle).toBe('Source Concept');
    expect(parsedA.backlinks[0].linkText).toContain('Target Hub');
  });
});
