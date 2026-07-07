import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { fetchArchitecture, type ArchitectureView } from '../api';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });

let diagramCounter = 0;

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
    mermaid.parse(code)
      .then(() => mermaid.render(id, code))
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

export default function Architecture({ projectDir }: { projectDir: string | null }) {
  const [view, setView] = useState<ArchitectureView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!projectDir) return;
    setView(null);
    setError(false);
    fetchArchitecture(projectDir).then(setView).catch(() => setError(true));
  }, [projectDir]);

  if (!projectDir) return <div className="p-6 text-zinc-500">Select a project first.</div>;
  if (error) return <div className="p-6 text-zinc-500">Could not load the architecture doc.</div>;
  if (!view) return <div className="p-6 text-zinc-500">Loading…</div>;

  if (!view.markdown) {
    return (
      <div className="p-6 text-zinc-500">
        No architecture doc yet. Run{' '}
        <code className="bg-zinc-900 rounded px-1.5 py-0.5">claude-hindsight architecture</code>{' '}
        in this project to generate one.
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 max-w-4xl">
      {view.staleBy > 0 && (
        <div className="mb-4 rounded-lg border border-amber-700/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          {view.staleBy} session{view.staleBy === 1 ? '' : 's'} behind — run{' '}
          <code className="bg-zinc-900 rounded px-1.5 py-0.5">claude-hindsight architecture</code> to refresh.
        </div>
      )}
      {renderMarkdownWithDiagram(view.markdown)}
    </main>
  );
}
