import { useEffect, useState } from 'react';
import { fetchAudit, type AuditReport, type RuleFinding } from '../api';

const BADGE: Record<RuleFinding['verdict'], string> = {
  violated: 'bg-red-500/15 text-red-400',
  dead: 'bg-zinc-500/15 text-zinc-400',
  followed: 'bg-emerald-500/15 text-emerald-400',
  unchecked: 'border border-dashed border-zinc-700 text-zinc-500',
};

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

function Rule({ f }: { f: RuleFinding }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800/60 py-3">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${BADGE[f.verdict]}`}>{f.verdict}</span>
        <p className="flex-1 text-sm text-zinc-200">{f.instruction.text}</p>
        <span className="shrink-0 text-xs text-zinc-500" title="estimated tokens injected across all sessions">
          {fmtTokens(f.estTotalTokens)} tok
        </span>
      </div>
      {f.evidence.length > 0 && (
        <button onClick={() => setOpen(!open)} className="mt-1 ml-16 text-xs text-red-400/80 hover:text-red-300">
          {open ? 'hide' : 'show'} evidence ({f.evidence.length})
        </button>
      )}
      {open && (
        <ul className="mt-1 ml-16 space-y-1">
          {f.evidence.map((e, i) => (
            <li key={i}><code className="text-xs bg-zinc-900 rounded px-1.5 py-0.5 text-zinc-400">{e}</code></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Audit() {
  const [reports, setReports] = useState<AuditReport[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => { fetchAudit().then(setReports).catch(() => setError(true)); }, []);

  if (error) return <div className="p-6 text-zinc-500">Could not load audit.</div>;
  if (!reports) return <div className="p-6 text-zinc-500">Analyzing CLAUDE.md files…</div>;
  if (reports.length === 0) return (
    <div className="p-6 text-zinc-500">No CLAUDE.md files found (looked in ~/.claude and each project root).</div>
  );

  const all = reports.flatMap((r) => r.findings);
  const problems = all.filter((f) => f.verdict === 'dead' || f.verdict === 'violated');
  const wasted = problems.filter((f) => f.verdict === 'dead').reduce((s, f) => s + f.estTotalTokens, 0);

  return (
    <main className="flex-1 overflow-y-auto p-6 max-w-4xl">
      <section className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'rules analyzed', value: String(all.length) },
          { label: 'dead or violated', value: String(problems.length) },
          { label: 'tokens spent on dead rules', value: fmtTokens(wasted) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs text-zinc-500 mt-1">{s.label}</div>
          </div>
        ))}
      </section>
      {reports.map((r) => (
        <section key={r.source} className="mb-8">
          <h2 className="text-sm font-semibold text-zinc-300 mb-1">{r.source}</h2>
          <p className="text-xs text-zinc-500 mb-3">checked against {r.totalSessions} sessions</p>
          {[...r.findings]
            .sort((a, b) => ['violated', 'dead', 'unchecked', 'followed'].indexOf(a.verdict) -
                            ['violated', 'dead', 'unchecked', 'followed'].indexOf(b.verdict))
            .map((f) => <Rule key={f.instruction.id} f={f} />)}
        </section>
      ))}
    </main>
  );
}
