import { useEffect, useState } from 'react';
import { fetchBriefing, runPolish, type Briefing as BriefingData, type ProjectSummary } from '../api';

const projectName = (p: ProjectSummary) =>
  p.cwd ? p.cwd.split(/[\\/]/).filter(Boolean).pop()! : p.projectDir;

const ENDING_STYLE: Record<string, string> = {
  clean: 'bg-emerald-500/15 text-emerald-400',
  error: 'bg-red-500/15 text-red-400',
  abandoned: 'bg-amber-500/15 text-amber-400',
};

const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export default function Briefing({ projects, selected, onSelect }: {
  projects: ProjectSummary[]; selected: string | null; onSelect: (dir: string) => void;
}) {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [polishing, setPolishing] = useState(false);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    fetchBriefing(selected)
      .then((b) => { if (live) setBriefing(b); })
      .catch(() => { if (live) setBriefing(null); });
    return () => { live = false; };
  }, [selected]);

  const polish = async () => {
    if (!selected) return;
    setPolishing(true);
    try {
      await runPolish(selected);
      fetchBriefing(selected).then(setBriefing).catch(() => setBriefing(null));
    } finally { setPolishing(false); }
  };

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-64 border-r border-zinc-800 overflow-y-auto p-2">
        {projects.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">
            No transcripts found. claude-dost reads sessions from ~/.claude/projects — run a few Claude Code sessions first.
          </p>
        )}
        {projects.map((p) => (
          <button key={p.projectDir} onClick={() => onSelect(p.projectDir)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm mb-0.5 ${
              selected === p.projectDir ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}>
            <div className="font-medium truncate">{projectName(p)}</div>
            <div className="text-xs text-zinc-500">{p.sessionCount} sessions · {fmtWhen(p.lastTs)}</div>
          </button>
        ))}
      </aside>
      <main className="flex-1 overflow-y-auto p-6 max-w-4xl">
        {briefing?.leftOff && (
          <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-zinc-300">Where you left off</h2>
              <button onClick={polish} disabled={polishing}
                className="text-xs px-3 py-1 rounded-md bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 disabled:opacity-50">
                {polishing ? 'Polishing…' : '✨ Polish this project'}
              </button>
            </div>
            {briefing.leftOff.lastAssistantText && (
              <p className="text-sm text-zinc-400 line-clamp-3">Claude: {briefing.leftOff.lastAssistantText}</p>
            )}
            {briefing.leftOff.lastUserText && (
              <p className="text-sm text-zinc-500 mt-1 line-clamp-2">You: {briefing.leftOff.lastUserText}</p>
            )}
          </section>
        )}
        <ol className="relative border-l border-zinc-800 ml-2 space-y-4">
          {briefing?.cards.map((c) => (
            <li key={c.sessionId} className="ml-4">
              <span className="absolute -left-1.5 mt-2 h-3 w-3 rounded-full bg-zinc-700 border-2 border-zinc-950" />
              <article className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-100">{c.goal}</p>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${ENDING_STYLE[c.ending]}`}>{c.ending}</span>
                </div>
                {c.outcome && <p className="text-sm text-zinc-400 italic mt-1">{c.outcome}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-zinc-500">
                  <span>{fmtWhen(c.when)}</span>
                  {c.durationMinutes !== null && <span>{c.durationMinutes} min</span>}
                  <span>{c.messageCount} messages</span>
                  <span>{fmtTokens(c.totalTokens)} tokens</span>
                  {c.filesEdited.length > 0 && <span>{c.filesEdited.length} files edited</span>}
                  {c.commandCount > 0 && <span>{c.commandCount} commands</span>}
                </div>
                {c.filesEdited.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.filesEdited.slice(0, 6).map((f) => (
                      <code key={f} className="text-xs bg-zinc-800/80 rounded px-1.5 py-0.5 text-zinc-400">
                        {f.split(/[\\/]/).pop()}
                      </code>
                    ))}
                  </div>
                )}
              </article>
            </li>
          ))}
        </ol>
        {briefing && briefing.hiddenNoiseSessions > 0 && (
          <p className="mt-4 text-xs text-zinc-600">{briefing.hiddenNoiseSessions} empty/noise sessions hidden</p>
        )}
      </main>
    </div>
  );
}
