import { useEffect, useState } from 'react';
import { fetchProjects, type ProjectSummary } from './api';
import Briefing from './views/Briefing';
import Audit from './views/Audit';

export default function App() {
  const [tab, setTab] = useState<'briefing' | 'audit'>('briefing');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then((p) => {
      setProjects(p);
      if (p.length > 0) setSelected(p[0].projectDir);
    }).catch(() => setProjects([]));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6">
        <h1 className="text-lg font-semibold tracking-tight">Claude Hindsight</h1>
        <nav className="flex gap-1">
          {(['briefing', 'audit'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-sm capitalize ${
                tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {t === 'briefing' ? 'Project Briefing' : 'Instruction Audit'}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'briefing'
        ? <Briefing projects={projects} selected={selected} onSelect={setSelected} />
        : <Audit />}
    </div>
  );
}
