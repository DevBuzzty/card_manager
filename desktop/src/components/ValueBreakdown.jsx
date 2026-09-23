import { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { valueBreakdown } from '../utils/breakdown';
import { fmtEUR } from '../utils/format';

const DIMENSIONS = [
  { id: 'type', label: 'Typ' }, { id: 'set', label: 'Set' }, { id: 'rarity', label: 'Rarität' }, { id: 'binder', label: 'Binder' },
];
const COLORS = ['var(--accent)', '#F5C542', '#00C49F', '#FF8042', '#4FA3FF', '#FF5DA2', '#8BD450', '#B0B0B0'];

// Spec G1 §4.6 — Aufteilung nach Wert: Kuchen + Liste.
export default function ValueBreakdown() {
  const [dimension, setDimension] = useState('type');
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!window.api) return;
    Promise.all([window.api.getCollection(), window.api.listAllCopies(), window.api.listContainers()])
      .then(([cards, copies, containers]) => setSrc({ cards: cards || [], copies: copies || [], containers: containers || [] }))
      .catch(() => setError('Aufteilung konnte nicht geladen werden.'));
  }, []);

  const groups = useMemo(() => (src ? valueBreakdown({ ...src, dimension }) : []), [src, dimension]);
  const top = groups.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="inline-flex bg-surface border border-line rounded-xl p-1 gap-1">
        {DIMENSIONS.map((d) => (
          <button key={d.id} onClick={() => setDimension(d.id)}
            className={`px-4 py-1.5 rounded-lg text-sm ${dimension === d.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-text'}`}>{d.label}</button>
        ))}
      </div>
      {error && <div className="text-sm text-bad">{error}</div>}
      {!src && !error && <div className="h-64 rounded-2xl bg-surface animate-pulse" />}
      {src && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 bg-surface border border-line rounded-2xl p-6">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top} dataKey="value" nameKey="label" innerRadius={60} outerRadius={95} paddingAngle={2} isAnimationActive={false}>
                  {top.map((g, i) => <Cell key={g.label} fill={COLORS[i % COLORS.length]} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--line)' }} itemStyle={{ color: 'var(--text)' }} formatter={(v) => fmtEUR(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="divide-y divide-line">
            {groups.length === 0 && <div className="text-sm text-muted">Keine Daten</div>}
            {groups.map((g, i) => (
              <div key={g.label} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: i < 8 ? COLORS[i] : '#555' }} />
                <span className="flex-1 truncate text-text">{g.label}</span>
                <span className="font-mono text-muted">{g.count}×</span>
                <span className="font-mono text-text w-28 text-right">{fmtEUR(g.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
