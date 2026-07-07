import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store } from '../src/indexer/store.js';
import { createMcpServer } from '../src/mcp/server.js';
import type { SessionFacts } from '../src/types.js';
import type { ArchRunner } from '../src/architecture/generate.js';

const facts = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: 's', projectDir: 'proj', cwd: 'C:\\work\\app', goal: 'ship the thing',
  firstTs: null, lastTs: '2026-07-01T00:00:00Z', messageCount: 1,
  inputTokens: 0, outputTokens: 0, filesEdited: [], commandsRun: [],
  skillsInvoked: [], errorCount: 0, ending: 'clean',
  lastUserText: null, lastAssistantText: null, skippedLines: 0, rateLimitResetAt: null,
  ...over,
});

// Connects a real MCP Client to the server over the SDK's in-memory
// transport pair — this exercises the actual protocol marshaling
// (tool registration, JSON-RPC request/response) without spawning a
// subprocess, which is the practical equivalent of driving stdio for
// test purposes.
async function connectedClient(deps: Parameters<typeof createMcpServer>[0]) {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('createMcpServer', () => {
  it('registers exactly the four expected tools', async () => {
    const store = new Store(':memory:');
    const client = await connectedClient({ store, dataDir: '/tmp/unused', claudeDir: '/tmp/unused', cwd: 'C:\\work\\app' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_architecture', 'get_briefing', 'refresh_architecture', 'run_audit'].sort(),
    );
    store.close();
  });

  it('calls get_briefing and returns real briefing data over the protocol', async () => {
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const client = await connectedClient({ store, dataDir: '/tmp/unused', claudeDir: '/tmp/unused', cwd: 'C:\\work\\app' });
    const result = await client.callTool({ name: 'get_briefing', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const body = JSON.parse(content[0].text) as { cards: { goal: string }[] };
    expect(body.cards[0].goal).toContain('ship the thing');
    store.close();
  });

  it('forwards the injected runner and the full flag through to refreshArchitecture', async () => {
    // The MCP protocol only carries { full } as tool arguments — there is no
    // way to pass a JS function over the wire — so the mock runner must be
    // injected via McpServerDeps.runner, never through client.callTool's
    // arguments. This is the only way this test avoids spawning the real
    // `claude` CLI (which could take minutes or hang in a full-mode call).
    const dataDir = mkdtempSync(join(tmpdir(), 'hindsight-mcpserver-'));
    const store = new Store(':memory:');
    store.upsertSession(facts({}));
    const calls: { tools: boolean }[] = [];
    const runner: ArchRunner = async (_prompt, opts) => {
      calls.push({ tools: opts.tools });
      return '## What this app does\nx\n## The main parts\nx\n' +
        '## How the pieces work together\nx\n' +
        '## Architecture Diagram\n```mermaid\nflowchart TD\n  A --> B\n```\n' +
        '## Recent changes\n- did a thing';
    };
    const client = await connectedClient({ store, dataDir, claudeDir: '/tmp/unused', cwd: 'C:\\work\\app', runner });
    const result = await client.callTool({ name: 'refresh_architecture', arguments: { full: true } });
    const content = result.content as { type: string; text: string }[];
    const body = JSON.parse(content[0].text) as { status: string };
    expect(body.status).toBe('generated');
    expect(calls).toHaveLength(1);
    expect(calls[0].tools).toBe(true);
    store.close();
  });

  it('returns a calm error payload, not a protocol error, for an unmatched cwd', async () => {
    const store = new Store(':memory:');
    const client = await connectedClient({ store, dataDir: '/tmp/unused', claudeDir: '/tmp/unused', cwd: 'C:\\nowhere' });
    const result = await client.callTool({ name: 'get_briefing', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    const body = JSON.parse(content[0].text) as { error: string };
    expect(body.error).toContain('No indexed history');
    store.close();
  });
});
