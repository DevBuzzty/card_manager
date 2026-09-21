import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { toCents, netCents, feeDefaultCents, diffText, euroCentsText } from '../utils/saleMath';
import { todayLocal } from '../utils/today';

const toInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));

// Spec H2 §5.2 -- Verkauf buchen. Gebucht und verteilt wird im Hauptprozess (sales.cjs), hier nur Vorschau.
export default function SaleDialog({ copyIds, initialGrossCents = null, onClose, onBooked }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState(() => ({ channel_id: 'cardmarket', sold_on: todayLocal(), gross: '', fees: '', shipping: '', note: '', feesTouched: false, grossTouched: false }));

  // Eigener Escape-Handler: solange der Dialog offen ist, soll Escape NUR ihn schliessen, nicht das
  // dahinterliegende CopySheet (das seinen eigenen Handler waehrend sellingOpen aussetzt).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // idsKey statt copyIds selbst in den Deps: CopySheet.jsx uebergibt copyIds={[copy.copy_id]} als
  // Inline-Array-Literal, das bei JEDEM Rendern eine neue Referenz ist -- ein Effekt auf [copyIds]
  // wuerde Vorschau/Kanaele bei jedem Tastendruck im Sheet neu laden und die Eingaben zuruecksetzen.
  // Gleiches Muster wie ExportDialog.jsx (dort mit `scope`, ebenfalls eine bei jedem Rendern neue Referenz).
  const idsKey = copyIds.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all([window.api.listSaleChannels(), window.api.previewSale(copyIds)])
      .then(([ch, pv]) => {
        if (!alive) return;
        setChannels(ch);
        setPreview(pv);
        setForm((f) => {
          const grossC = initialGrossCents ?? pv.marketCents;
          const fee = ch.find((c) => c.channel_id === f.channel_id)?.fee_percent ?? 0;
          return f.grossTouched ? f : { ...f, gross: toInput(grossC), fees: f.feesTouched ? f.fees : toInput(feeDefaultCents(grossC, fee)) };
        });
      })
      .catch((e) => { if (alive) setError(e?.message || 'Laden fehlgeschlagen.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, initialGrossCents]);

  const feeOf = (id) => channels?.find((c) => c.channel_id === id)?.fee_percent ?? 0;
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    if (!next.feesTouched && ('gross' in patch || 'channel_id' in patch)) {
      const g = toCents(parse(next.gross)) ?? 0;
      next.fees = toInput(feeDefaultCents(g, feeOf(next.channel_id)));
    }
    return next;
  });

  const net = useMemo(() => netCents({ gross: parse(form.gross) ?? 0, fees: parse(form.fees), shipping: parse(form.shipping) }), [form]);
  const market = preview?.marketCents ?? 0;

  const book = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.bookSale({ copyIds, channel_id: form.channel_id, sold_on: form.sold_on,
        gross: parse(form.gross), fees: parse(form.fees), shipping: parse(form.shipping), note: form.note });
      if (!res?.success) { setError(res?.error || 'Buchen fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      onBooked?.(res.sale_id);
    } catch (e) { setError(e?.message || 'Buchen fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  const field = 'w-full bg-obsidian-800 border border-line rounded-lg px-3 py-2 text-sm text-ink';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="w-full max-w-md bg-obsidian-700 border border-line rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Verkauft buchen</h2>
          <button type="button" onClick={onClose} className="p-1 text-ink-muted hover:text-ink" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>
        {!preview || !channels ? <p className="text-ink-faint">…</p> : (
          <>
            <p className="text-sm text-ink-muted">{preview.items.length} {preview.items.length === 1 ? 'Karte' : 'Karten'} · Marktwert {euroCentsText(market)}</p>
            <label className="block text-xs text-ink-muted">Kanal
              <select className={field} value={form.channel_id} onChange={(e) => set({ channel_id: e.target.value })}>
                {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}{c.fee_percent ? ` (${String(c.fee_percent).replace('.', ',')} %)` : ''}</option>)}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">Datum
              <input type="date" className={field} value={form.sold_on} onChange={(e) => set({ sold_on: e.target.value })} />
            </label>
            <label className="block text-xs text-ink-muted">Gesamtpreis (€)
              <input inputMode="decimal" className={field} value={form.gross} onChange={(e) => set({ gross: e.target.value, grossTouched: true })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-ink-muted">Gebühren (€)
                <input inputMode="decimal" className={field} value={form.fees} onChange={(e) => set({ fees: e.target.value, feesTouched: true })} />
              </label>
              <label className="block text-xs text-ink-muted">Versand (€)
                <input inputMode="decimal" className={field} placeholder="nicht erfasst" value={form.shipping} onChange={(e) => set({ shipping: e.target.value })} />
              </label>
            </div>
            <label className="block text-xs text-ink-muted">Notiz
              <input className={field} value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </label>
            <div className="text-sm">
              <div className="text-ink">Netto {euroCentsText(net)}</div>
              <div className={net >= market ? 'text-emerald-400' : 'text-crit'}>{diffText(net, market)} gegenüber Marktwert</div>
            </div>
            {error && <p className="text-sm text-crit">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Abbrechen</button>
              <button type="button" onClick={book} disabled={busy || preview.items.length === 0}
                className="px-4 py-2 rounded-lg text-sm bg-space-violet text-white disabled:opacity-50">{busy ? 'Wird gebucht…' : 'Buchen'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
