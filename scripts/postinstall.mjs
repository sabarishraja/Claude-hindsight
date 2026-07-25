// The dashboard UI is a separate npm project with its own dependencies, and a root
// `npm install` does not touch it. Without this, a fresh clone following the README
// (`npm install && npm run build`) fails at the vite step with an unresolved
// @vitejs/plugin-react — the backend builds, the UI doesn't, and `--web` serves no UI.
//
// This is a no-op for people installing the published package: `files` ships ui/dist
// (the built assets) but not ui/ source, so ui/package.json is absent and there is
// nothing to install. Never fail the parent install over this — a broken postinstall
// would block `npx claude-hindsight` entirely, which is far worse than a missing UI.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiPackageJson = join(root, 'ui', 'package.json');

if (!existsSync(uiPackageJson)) process.exit(0);

try {
  // shell: true so this resolves npm.cmd on Windows, same reason the `claude` CLI
  // callers use exec rather than execFile.
  execFileSync('npm', ['install', '--prefix', join(root, 'ui')], { stdio: 'inherit', shell: true });
} catch {
  console.warn('\n[claude-hindsight] Could not install the dashboard UI dependencies.');
  console.warn('The CLI still works. For the web dashboard, run: npm install --prefix ui\n');
}
