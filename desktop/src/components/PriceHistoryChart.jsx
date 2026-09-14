import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { computeSteps, todayUtc, fmtDayDE, FAMILY_LABELS } from '../utils/priceSteps';
import { fmtEUR } from '../utils/format';

const WINDOWS = [30, 90, 365];
const ts = (day) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// Spec G1 §4.6 — Stufenlinie pro Printing. Laedt beim Oeffnen und bei jeder Preisaenderung neu.
export default function PriceHistoryChart({ printing }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(() => !window.api?.getCardHistory);
  const [windowDays, setWindowDays] = useState(30);
  const { id, set_code, language, rarity } = printing;

  useEffect(() => {
    if (!window.api?.getCardHistory) return undefined;
    let alive = true;
    const load = () => window.api.getCardHistory({ id, set_code, language, rarity })
      .then((r) => { if (alive) { setRows(r || []); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    load();
    const off = window.api.onPriceUpdate?.(() => load());
    return () => { alive = false; off?.(); };
  }, [id, set_code, language, rarity]);

  const steps = useMemo(() => (rows ? computeSteps(rows, todayUtc(), windowDays) : null), [rows, windowDays]);

  if (!rows) {
    return <div className="text-[11px] text-ink-faint py-1">{error ? 'Verlauf nicht verfügbar' : 'Verlauf lädt …'}</div>;
  }
  if (steps.kind === 'none') return <div className="text-[11px] text-ink-faint py-1">Noch kein Verlauf</div>;
  if (steps.kind === 'flat') {
    return <div className="text-[11px] text-ink-faint py-1">Seit {fmtDayDE(steps.flatDay)} unverändert {fmtEUR(steps.flatPrice)}</div>;
  }
  const data = steps.points.map((p) => ({ t: ts(p.day), price: p.price }));
  return (
    <div className="mt-1">
      <div className="flex gap-1 mb-1">
        {WINDOWS.map((w) => (
          <button key={w} onClick={() => setWindowDays(w)}
            className={`px-2 py-0.5 rounded text-[10px] ${windowDays === w ? 'bg-space-violet text-white' : 'text-ink-faint hover:text-ink border border-line'}`}>{w} T</button>
        ))}
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 6, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 9, fill: '#888' }} tickFormatter={(t) => fmtDayDE(dayOf(t))} />
            <YAxis width={48} tick={{ fontSize: 9, fill: '#888' }} domain={['auto', 'auto']} tickFormatter={(v) => fmtEUR(v)} />
            <Tooltip contentStyle={{ backgroundColor: '#121212', borderRadius: '8px', border: '1px solid #333', fontSize: 11 }}
              labelFormatter={(t) => fmtDayDE(dayOf(t))} formatter={(v) => [fmtEUR(v), 'Preis']} />
            <Line type="stepAfter" dataKey="price" stroke="#9D00FF" strokeWidth={2} dot={false} isAnimationActive={false} />
            {steps.markers.map((m) => (
              <ReferenceLine key={m.day} x={ts(m.day)} stroke="#F5C542" strokeDasharray="4 3"
                label={{ value: `Quelle: ${FAMILY_LABELS[m.family]}`, position: 'insideTopLeft', fill: '#F5C542', fontSize: 9 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
