import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import SaleDetail from './SaleDetail';
import { euroCentsText, diffText } from '../utils/saleMath';
import { createLatestOnly } from '../utils/busyGate';
import { todayLocal } from '../utils/today';

// Spec H2 §7 -- Insights-Reiter „Verkäufe". Gerechnet wird im Hauptprozess (sales.cjs/sales-math.cjs), hier nur Anzeige.
const PERIODS = [{ id: 'monat', label: 'Dieser Monat' }, { id: 'jahr', label: 'Dieses Jahr' }, { id: 'gesamt', label: 'Gesamt' }];
const signed = (c) => (c > 0 ? `+${euroCentsText(c)}` : euroCentsText(c));
const dateText = (iso) => String(iso || '').split('-').reverse().join('.');
const monthText = (m) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;

const Tile = ({ label, children, className = 'text-ink' }) => (
  <div className="bg-obsidian-700 border border-line rounded-xl p-4">
    <div className="text-xs text-ink-muted uppercase tracking-wider">{label}</div>
    <div className={`text-xl font-mono mt-1 ${className}`}>{children}</div>
  </div>
);

export default function SalesPanel() {
  const [period, setPeriod] = useState('monat');
  const [today] = useState(() => todayLocal());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const latest = useRef(createLatestOnly());

  const load = useCallback(() => {
    const token = latest.current.start();
    return window.api.salesOverview({ period, today })
      .then((d) => { if (latest.current.isCurrent(token)) { setData(d); setError(null); } })
      .catch(() => { if (latest.current.isCurrent(token)) setError('Verkäufe konnten nicht geladen werden.'); });
  }, [period, today]);

  useEffect(() => {
    const seq = latest.current;
    load();
    const onDirty = () => { load(); };
    const offSales = window.api.onSalesChanged?.(onDirty);
    const offColl = window.api.onCollectionChanged?.(onDirty);
    window.addEventListener('collection-dirty', onDirty);
    return () => {
      seq.start(); // offene Antworten verwerfen
      offSales?.(); offColl?.(); window.removeEventListener('collection-dirty', onDirty);
    };
  }, [load]);

  const pick = (p) => { if (p !== period) { setData(null); setPeriod(p); } };
  const t = data?.totals;

  return (
    <div className="space-y-5">
      <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" onClick={() => pick(p.id)}
            className={`px-4 py-1.5 rounded-lg text-sm ${period === p.id ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>{p.label}</button>
        ))}
      </div>

      {error && <p className="text-sm text-crit">{error}</p>}

      {!data ? <p className="text-ink-faint">…</p> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Netto">{euroCentsText(t.netCents)}</Tile>
            <Tile label="Marktwert beim Verkauf">{euroCentsText(t.marketCents)}</Tile>
            <Tile label="Differenz" className={t.netCents >= t.marketCents ? 'text-emerald-400' : 'text-crit'}>{diffText(t.netCents, t.marketCents)}</Tile>
            <Tile label="Verkäufe">{`${t.sales} · ${t.cards} Karten`}</Tile>
          </div>

          <div className="bg-obsidian-700 border border-line rounded-xl p-4 overflow-x-auto">
            {data.byChannel.length === 0 ? <p className="text-sm text-ink-faint">Keine Verkäufe im Zeitraum.</p> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted uppercase tracking-wider">
                    <th className="py-1 pr-3">Kanal</th><th className="py-1 pr-3 text-right">Verkäufe</th><th className="py-1 pr-3 text-right">Netto</th>
                    <th className="py-1 pr-3 text-right">Gebühren</th><th className="py-1 text-right">Differenz</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byChannel.map((c) => (
                    <tr key={c.channel_id} className="border-t border-line text-ink">
                      <td className="py-1.5 pr-3">{c.channel_name}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{c.sales}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{euroCentsText(c.netCents)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{euroCentsText(c.feesCents)}</td>
                      <td className={`py-1.5 text-right font-mono ${c.diffCents >= 0 ? 'text-emerald-400' : 'text-crit'}`}>{signed(c.diffCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-obsidian-700 border border-line rounded-xl p-4">
            <div className="text-xs text-ink-muted uppercase tracking-wider mb-2">Netto je Monat</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byMonth.map((m) => ({ label: monthText(m.month), euro: m.netCents / 100, cents: m.netCents }))}>
                  <XAxis dataKey="label" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} width={48} />
                  <Tooltip contentStyle={{ backgroundColor: '#121212', borderRadius: '8px', border: '1px solid #333' }} itemStyle={{ color: '#fff' }}
                    formatter={(_v, _n, item) => [euroCentsText(item.payload.cents), 'Netto']} />
                  <Bar dataKey="euro" fill="#9D00FF" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-obsidian-700 border border-line rounded-xl divide-y divide-line">
            {data.sales.length === 0 ? <p className="p-4 text-sm text-ink-faint">Keine Verkäufe im Zeitraum.</p> : data.sales.map((s) => {
              const cancelled = s.status === 'storniert';
              return (
                <button key={s.sale_id} type="button" onClick={() => setOpenId(s.sale_id)}
                  className={`w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-left text-sm hover:bg-obsidian-800 ${cancelled ? 'line-through text-ink-faint' : 'text-ink'}`}>
                  <span className="font-mono">{dateText(s.sold_on)}</span>
                  <span>{s.channel_name}</span>
                  <span className="text-ink-muted">{s.cards} {s.cards === 1 ? 'Karte' : 'Karten'}</span>
                  {cancelled && <span className="inline-block text-xs">storniert</span>}
                  {s.doubleSold && <span className="inline-block text-xs px-2 py-0.5 rounded bg-crit/20 text-crit">Karte doppelt verkauft</span>}
                  <span className="ml-auto font-mono">{euroCentsText(s.netCents)}</span>
                  <span className={`font-mono ${cancelled ? '' : s.netCents >= s.marketCents ? 'text-emerald-400' : 'text-crit'}`}>{diffText(s.netCents, s.marketCents)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {openId && <SaleDetail saleId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
