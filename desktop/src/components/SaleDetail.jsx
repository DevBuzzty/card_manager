import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { toCents, netCents, diffText, euroCentsText } from '../utils/saleMath';

const toInput = (v) => { const c = toCents(v); return c == null ? '' : (c / 100).toFixed(2).replace('.', ','); };
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));
const dateText = (iso) => String(iso || '').split('-').reverse().join('.');
const Row = ({ label, children, className = 'text-text' }) => (
  <div className="flex justify-between"><span className="text-muted">{label}</span><span className={`font-mono ${className}`}>{children}</span></div>
);

// Spec H2 §6/§7 -- ein Verkauf mit Positionen; Bearbeiten, Teil-Rückgabe und Storno (nur aktive Verkäufe).
// Verteilt wird im Hauptprozess (sales.cjs); value_at_sale bleibt eingefroren.
export default function SaleDetail({ saleId, doubleSold = false, orphaned = false, onClose, onChanged }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [channels, setChannels] = useState([]);
  const [form, setForm] = useState(null); // null = nicht im Bearbeiten
  const alive = useRef(true);

  const load = useCallback(() => Promise.all([window.api.saleDetail(saleId), window.api.listSaleChannels()])
    .then(([d, ch]) => { if (alive.current) { setDetail(d); setChannels(Array.isArray(ch) ? ch : []); } })
    .catch((e) => { if (alive.current) setError(e?.message || 'Verkauf konnte nicht geladen werden.'); }), [saleId]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  const sale = detail?.sale;
  const items = detail?.items || [];
  const live = items.filter((it) => !it.deleted);
  const active = sale?.status === 'aktiv';
  const net = sale ? netCents(sale) : 0;
  const market = live.reduce((a, it) => a + (toCents(it.value_at_sale) || 0), 0);

  // Der eigene Kanal steht auch dann zur Wahl, wenn er inzwischen ausgeblendet ist.
  const channelOptions = sale && !channels.some((c) => c.channel_id === sale.channel_id)
    ? [{ channel_id: sale.channel_id, name: sale.channel_name }, ...channels]
    : channels;

  const startEdit = () => {
    setError(null);
    setForm({ channel_id: sale.channel_id, sold_on: sale.sold_on, gross: toInput(sale.gross), fees: toInput(sale.fees),
      shipping: toInput(sale.shipping), note: sale.note || '', returned: [] });
  };
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleReturn = (copyId) => setForm((f) => ({ ...f,
    returned: f.returned.includes(copyId) ? f.returned.filter((x) => x !== copyId) : [...f.returned, copyId] }));
  const formNet = form ? netCents({ gross: parse(form.gross) ?? 0, fees: parse(form.fees), shipping: parse(form.shipping) }) : 0;
  const formMarket = form ? live.filter((it) => !form.returned.includes(it.copy_id)).reduce((a, it) => a + (toCents(it.value_at_sale) || 0), 0) : 0;

  const save = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.updateSale({ sale_id: sale.sale_id, channel_id: form.channel_id, sold_on: form.sold_on,
        gross: parse(form.gross), fees: parse(form.fees), shipping: parse(form.shipping), note: form.note, returnCopyIds: form.returned });
      if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      onChanged?.();
      setForm(null);
      await load();
    } catch (e) { setError(e?.message || 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  const cancel = () => gate.run(async () => {
    if (!window.confirm('Verkauf stornieren? Alle Karten kommen in die Sammlung zurück.')) return;
    setBusy(true); setError(null);
    try {
      const res = await window.api.cancelSale(sale.sale_id);
      if (!res?.success) { setError(res?.error || 'Stornieren fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      onChanged?.();
      onClose?.();
    } catch (e) { setError(e?.message || 'Stornieren fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  const field = 'w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-surface border border-line rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text">Verkauf</h2>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-text" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>

        {!sale ? <p className="text-muted">{error || '…'}</p> : (
          <>
            {!form && (
              <>
                <div className="text-sm space-y-1">
                  <div className={active ? 'text-text' : 'text-muted'}>
                    <span className="font-mono">{dateText(sale.sold_on)}</span> · {sale.channel_name} · {active ? 'aktiv' : 'storniert'}
                  </div>
                  {sale.note && <div className="text-muted">{sale.note}</div>}
                </div>
                {doubleSold && <p className="text-sm text-bad">Karte doppelt verkauft – eine Position zählt beim anderen Verkauf.</p>}
                {orphaned && <p className="text-sm text-bad">Position ohne verkauftes Exemplar – bitte prüfen. Sie zählt in der Übersicht nicht mit.</p>}
                <div className="text-sm space-y-0.5 bg-bg border border-line rounded-lg p-3">
                  <Row label="Preis">{euroCentsText(toCents(sale.gross) || 0)}</Row>
                  <Row label="Gebühren">{euroCentsText(toCents(sale.fees) || 0)}</Row>
                  <Row label="Versand">{sale.shipping == null ? 'nicht erfasst' : euroCentsText(toCents(sale.shipping) || 0)}</Row>
                  <Row label="Netto">{euroCentsText(net)}</Row>
                  <Row label="Marktwert">{euroCentsText(market)}</Row>
                  <Row label="Differenz" className={net >= market ? 'text-emerald-400' : 'text-bad'}>{diffText(net, market)}</Row>
                </div>
              </>
            )}

            {form && (
              <div className="space-y-3">
                <label className="block text-xs text-muted">Kanal
                  <select className={field} value={form.channel_id} onChange={(e) => set({ channel_id: e.target.value })}>
                    {channelOptions.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-muted">Datum
                  <input type="date" className={field} value={form.sold_on} onChange={(e) => set({ sold_on: e.target.value })} />
                </label>
                <label className="block text-xs text-muted">Gesamtpreis (€)
                  <input inputMode="decimal" className={field} value={form.gross} onChange={(e) => set({ gross: e.target.value })} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-muted">Gebühren (€)
                    <input inputMode="decimal" className={field} value={form.fees} onChange={(e) => set({ fees: e.target.value })} />
                  </label>
                  <label className="block text-xs text-muted">Versand (€)
                    <input inputMode="decimal" className={field} placeholder="nicht erfasst" value={form.shipping} onChange={(e) => set({ shipping: e.target.value })} />
                  </label>
                </div>
                <label className="block text-xs text-muted">Notiz
                  <input className={field} value={form.note} onChange={(e) => set({ note: e.target.value })} />
                </label>
                <div className="text-sm">
                  <div className="text-text">Netto {euroCentsText(formNet)}</div>
                  <div className={formNet >= formMarket ? 'text-emerald-400' : 'text-bad'}>{diffText(formNet, formMarket)} gegenüber Marktwert</div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {items.map((it) => {
                const gone = !!it.deleted;
                return (
                  <div key={it.copy_id} className={`flex items-center gap-3 p-2 rounded-lg border border-line ${gone ? 'opacity-50' : ''}`}>
                    {it.image_url ? <img src={it.image_url} alt="" className="w-10 h-14 object-cover rounded" /> : <div className="w-10 h-14 rounded bg-bg" />}
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="text-text truncate">{it.name || it.card_id}</div>
                      <div className="text-[11px] font-mono text-muted">{it.set_code} · {it.rarity} · {it.language}</div>
                      <div className="text-[11px] font-mono text-muted">{it.condition} · {it.edition}</div>
                    </div>
                    <div className="text-right text-[11px] font-mono">
                      <div className="text-muted">Marktwert {euroCentsText(toCents(it.value_at_sale) || 0)}</div>
                      {gone ? <div className="text-muted">zurückgenommen</div> : <div className="text-text">Anteil {euroCentsText(toCents(it.share) || 0)}</div>}
                    </div>
                    {form && !gone && (
                      <label className="flex items-center gap-1 text-xs text-muted shrink-0">
                        <input type="checkbox" checked={form.returned.includes(it.copy_id)} onChange={() => toggleReturn(it.copy_id)} /> zurücknehmen
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <p className="text-sm text-bad">{error}</p>}

            {active && (
              <div className="flex justify-end gap-2">
                {form ? (
                  <>
                    <button type="button" onClick={() => { setForm(null); setError(null); }} className="px-3 py-2 text-sm text-muted hover:text-text">Abbrechen</button>
                    <button type="button" onClick={save} disabled={busy}
                      className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50">{busy ? 'Wird gespeichert…' : 'Speichern'}</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={cancel} disabled={busy}
                      className="px-3 py-2 rounded-lg text-sm border border-bad/40 text-bad hover:bg-bad/10 disabled:opacity-50">Stornieren</button>
                    <button type="button" onClick={startEdit} disabled={busy}
                      className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50">Bearbeiten</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
