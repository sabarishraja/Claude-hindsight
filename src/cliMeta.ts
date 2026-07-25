import { readFileSync } from 'node:fs';

// A newcomer's first instinct is `--help` / `--version`; without these the CLI
// would silently fall through to indexing + a briefing, which is confusing. These
// are pure and side-effect-free so cli.ts can print them and return immediately.

export const USAGE = `claude-hindsight — local briefings, audits & eval from your Claude Code transcripts

Usage: claude-hindsight [command] [options]

Commands:
  (default)              Terminal briefing for the current directory's project
  architecture           Refresh (if stale) and print the living architecture doc
  statusline             Render one Claude Code statusline frame (used by the statusLine setting)
  eval                   Run the instruction-audit eval and print the score report
  eval snapshot <name>   Freeze the current project (sessions + CLAUDE.md) into a fixture
  eval label <name>      Interactively label a fixture's expected verdicts
  mcp                    Run the MCP server over stdio

Options:
  --web                  Serve the web dashboard (default http://localhost:4756)
  --port <n>             Port for --web (default 4756)
  --no-open              With --web, don't auto-open a browser tab
  --plain                No colors/box-drawing; silent when the directory has no history
  --claude-dir <path>    Use a Claude directory other than ~/.claude
  -h, --help             Show this help
  -v, --version          Show the installed version

Everything runs 100% locally. The only external process is your own \`claude\` CLI,
and only for the opt-in Polish and architecture-doc features.`;

// Returns the intent implied by a top-level flag, or null if none is present.
// argv is process.argv.slice(2) — the tokens after the program name.
export function topLevelIntent(argv: string[]): 'help' | 'version' | null {
  if (argv.includes('-h') || argv.includes('--help')) return 'help';
  if (argv.includes('-v') || argv.includes('--version')) return 'version';
  return null;
}

// Reads the "version" field from a package.json, degrading to a sentinel rather
// than throwing — a version lookup must never be able to crash the CLI.
export function readVersion(packageJsonPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}
