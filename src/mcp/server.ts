import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Store } from '../indexer/store.js';
import type { ArchRunner } from '../architecture/generate.js';
import { getBriefingTool, getArchitectureTool, runAuditTool, refreshArchitectureTool } from './tools.js';
import type { ToolResult } from './tools.js';

// The SDK's registered-tool callbacks must return its own CallToolResult
// type, which (unlike our ToolResult) declares an index signature. The two
// are structurally compatible at runtime (same { content: [...] } shape);
// this cast just satisfies the compiler at the seam between our tools.ts
// return type and the SDK's, without changing tools.ts (out of this task's
// scope).
function asCallToolResult(result: ToolResult): CallToolResult {
  return result as CallToolResult;
}

export interface McpServerDeps {
  store: Store | null;
  dataDir: string;
  claudeDir: string;
  cwd: string;
  // Testing seam only: the real MCP protocol has no way to carry a JS
  // function as a tool argument, so this is how integration tests inject a
  // mock instead of spawning the real `claude` CLI. Production callers
  // (the `mcp` CLI subcommand) always omit this, so refreshArchitecture
  // falls back to its own defaultRunClaude.
  runner?: ArchRunner;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: 'claude-hindsight', version: '0.2.0' });

  server.registerTool(
    'get_briefing',
    {
      title: 'Get project briefing',
      description: 'Returns the current project\'s recent session history: goals, outcomes, ' +
        'files edited, and how each session ended. Pure read; never runs the indexer.',
      inputSchema: {},
    },
    async () => asCallToolResult(getBriefingTool(deps.store, deps.cwd)),
  );

  server.registerTool(
    'get_architecture',
    {
      title: 'Get architecture doc',
      description: 'Returns the cached living architecture doc for the current project, and ' +
        'how many sessions behind it is. Pure read; never generates a new doc.',
      inputSchema: {},
    },
    async () => asCallToolResult(getArchitectureTool(deps.store, deps.dataDir, deps.cwd)),
  );

  server.registerTool(
    'run_audit',
    {
      title: 'Audit CLAUDE.md instructions',
      description: 'Cross-checks the current project\'s CLAUDE.md (and the global one) against ' +
        'actual session transcripts, flagging violated/dead rules. Pure read.',
      inputSchema: {},
    },
    async () => asCallToolResult(runAuditTool(deps.store, deps.claudeDir, deps.cwd)),
  );

  server.registerTool(
    'refresh_architecture',
    {
      title: 'Refresh architecture doc',
      description: 'Regenerates the architecture doc. This may take up to several minutes and ' +
        'calls the user\'s local `claude` CLI — only call this when the user explicitly wants ' +
        'a fresh doc, never automatically as a side effect of answering another question.',
      inputSchema: {
        full: z.boolean().optional().describe(
          'Force a full re-exploration of the codebase instead of a cheap incremental refresh.',
        ),
      },
    },
    async ({ full }) => asCallToolResult(await refreshArchitectureTool(deps.store, deps.dataDir, deps.cwd, { full }, deps.runner)),
  );

  return server;
}
