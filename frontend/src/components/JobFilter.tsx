import { useMemo, useState } from 'react';
import type { Project } from '../api/types';

// Searchable multi-select of Jobs (projects). Value is a Set of project codes.
export function JobFilter({ projects, selected, onChange }: {
  projects: Project[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => !selected.has(p.code));
    const m = q ? list.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(q)) : list;
    return m.slice(0, 50);
  }, [projects, selected, query]);

  function add(code: string) {
    const next = new Set(selected); next.add(code); onChange(next);
    setQuery(''); setOpen(false);
  }
  function remove(code: string) {
    const next = new Set(selected); next.delete(code); onChange(next);
  }

  return (
    <span className="jobfilter">
      <span className="msummary__filterbar-label">Job:</span>
      {[...selected].map((code) => (
        <span key={code} className="jobfilter__chip">
          {code}
          <button type="button" aria-label={`เอา ${code} ออก`} onClick={() => remove(code)}>×</button>
        </span>
      ))}
      <span className="combo jobfilter__combo">
        <input className="input" placeholder="+ กรอง Job (รหัส/ชื่อ)…" value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {open && (
          <ul className="combo__list">
            {matches.map((p) => (
              <li key={p.projectId} onMouseDown={() => add(p.code)}><b>{p.code}</b> · {p.name}</li>
            ))}
            {matches.length === 0 && <li className="muted">ไม่พบ Job</li>}
          </ul>
        )}
      </span>
    </span>
  );
}
