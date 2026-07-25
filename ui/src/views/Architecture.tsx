import { useEffect, useRef, useState } from 'react';
import { fetchArchitecture, refreshArchitecture, type ArchitectureView } from '../api';

let diagramCounter = 0;
let mermaidInitialized = false;

async function loadMermaid() {
  const { default: mermaid } = await import('mermaid');
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
    mermaidInitialized = true;
  }
  return mermaid;
}

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const id = `arch-diagram-${diagramCounter++}`;
    // Validate first: mermaid.render() injects a visible error graphic into the DOM
    // on invalid syntax (it doesn't clean up its offscreen render container on failure),
    // so we must never call it with input that hasn't already parsed successfully.
    loadMermaid()
      .then((mermaid) => mermaid.parse(code).then(() => mermaid.render(id, code)))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [code]);

  if (failed) {
    return (
      <div className="my-4 rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
        <p className="mb-2 text-sm text-zinc-500">Diagram couldn&apos;t be rendered.</p>
        <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-400">{code}</pre>
      </div>
    );
  }

  return <div ref={containerRef} className="my-4" />;
}

const MERMAID_FENCE = /```mermaid\n([\s\S]*?)```/;

function renderMarkdownWithDiagram(markdown: string) {
  const match = markdown.match(MERMAID_FENCE);
  if (!match || match.index === undefined) {
    return <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">{markdown}</pre>;
  }
  const before = markdown.slice(0, match.index);
  const after = markdown.slice(match.index + match[0].length);
  const code = match[1];
  return (
    <>
      <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">{before}</pre>
      <MermaidDiagram code={code} />
      <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">{after}</pre>
    </>
  );
}

const BTN = 'text-xs px-3 py-1 rounded-md bg-indigo-500/15 text-indigo-300 ' +
  'hover:bg-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed';

// 'up-to-date' isn't a failure — the doc simply already covered every session, and the
// existing view stays exactly as it was. Only a rejected/errored run is worth a warning tone.
const TONE: Record<string, string> = {
  generated: 'border-emerald-700/40 bg-emerald-500/10 text-emerald-300',
  'up-to-date': 'border-zinc-700 bg-zinc-900/60 text-zinc-400',
  rejected: 'border-amber-700/40 bg-amber-500/10 text-amber-300',
  error: 'border-amber-700/40 bg-amber-500/10 text-amber-300',
};

export default function Architecture({ projectDir }: { projectDir: string | null }) {
  const [view, setView] = useState<ArchitectureView | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<null | 'incremental' | 'full'>(null);
  const [notice, setNotice] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    if (!projectDir) return;
    let live = true;
    setView(null);
    setError(false);
    setNotice(null);
    fetchArchitecture(projectDir)
      .then((v) => { if (live) setView(v); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [projectDir]);

  const refresh = async (full: boolean) => {
    if (!projectDir || busy) return;
    setBusy(full ? 'full' : 'incremental');
    setNotice(null);
    try {
      const outcome = await refreshArchitecture(projectDir, full);
      setView(outcome.view);
      setNotice({ status: outcome.status, message: outcome.message });
    } catch {
      // Never surface a raw fetch failure here — a doc you can still read beats a crashed view.
      setNotice({ status: 'error', message: 'Could not reach the refresh endpoint. The doc below is unchanged.' });
    } finally {
      setBusy(null);
    }
  };

  if (!projectDir) return <div className="p-6 text-zinc-500">Select a project first.</div>;
  if (error) return <div className="p-6 text-zinc-500">Could not load the architecture doc.</div>;
  if (!view) return <div className="p-6 text-zinc-500">Loading…</div>;

  const buttons = (
    <div className="flex items-center gap-2">
      <button onClick={() => refresh(false)} disabled={busy !== null} className={BTN}>
        {busy === 'incremental' ? 'Refreshing…' : '⟳ Refresh'}
      </button>
      <button onClick={() => refresh(true)} disabled={busy !== null} className={BTN}
        title="Re-explore the whole codebase from scratch instead of only what changed. Slower.">
        {busy === 'full' ? 'Rebuilding…' : 'Full rebuild'}
      </button>
    </div>
  );

  const noticeBanner = notice && (
    <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${TONE[notice.status] ?? TONE.error}`}>
      {notice.message}
    </div>
  );

  // Generation shells out to the `claude` CLI and can take minutes, so say so rather than
  // leaving someone staring at a disabled button wondering whether it registered the click.
  const busyHint = busy && (
    <p className="mt-3 text-xs text-zinc-500">
      Running the <code className="bg-zinc-900 rounded px-1 py-0.5">claude</code> CLI
      {busy === 'full' ? ' to explore the codebase' : ' on what changed'} — this can take a
      few minutes. You can leave this tab open.
    </p>
  );

  if (!view.markdown) {
    return (
      <main className="flex-1 overflow-y-auto p-6 max-w-4xl">
        {noticeBanner}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h2 className="text-sm font-semibold text-zinc-300 mb-1">No architecture doc yet</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Generate a plain-English map of this codebase — what it does, its main parts, and how
            they fit together. The first run explores the whole repo read-only, so it takes longest.
          </p>
          <button onClick={() => refresh(false)} disabled={busy !== null} className={BTN}>
            {busy ? 'Generating…' : '✨ Generate now'}
          </button>
          {busyHint}
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-xs text-zinc-500">
          {view.meta && <>v{view.meta.docVersion} · updated {fmtRefreshed(view.meta.lastRefreshAt)}</>}
        </div>
        {buttons}
      </div>
      {noticeBanner}
      {view.staleBy > 0 && !busy && (
        <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          {view.staleBy} session{view.staleBy === 1 ? '' : 's'} behind — hit Refresh to bring it up to date.
        </div>
      )}
      {busyHint}
      {renderMarkdownWithDiagram(view.markdown)}
    </main>
  );
}

function fmtRefreshed(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}
