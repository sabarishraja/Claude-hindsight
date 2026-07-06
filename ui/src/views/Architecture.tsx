import { useEffect, useState } from 'react';
import { fetchArchitecture, type ArchitectureView } from '../api';

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
      <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-200 leading-relaxed">{view.markdown}</pre>
    </main>
  );
}
