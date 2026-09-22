import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { toCents, netCents, feeDefaultCents, diffText, euroCentsText } from '../utils/saleMath';
import { todayLocal } from '../utils/today';

const toInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));
// Wie feeValue in Settings.jsx (SaleChannelSettings): Gebühr in % mit Komma erlaubt, leer = 0.
const feeValue = (s) => (String(s ?? '').trim() === '' ? 0 : Number(String(s).trim().replace(',', '.')));
const NEW_CHANNEL = '__new__'; // Pseudo-Wert der Kanal-Auswahl; nie echter Formularwert, siehe Kanal-onChange.

// Spec H2 §5.2 -- Verkauf buchen. Gebucht und verteilt wird im Hauptprozess (sales.cjs), hier nur Vorschau.
// Spec H3a §7.1 -- mit `listing` ({ listing_id, channel_id, priceCents }): Kanal des Angebots vorbelegt, Karten
// abwaehlbar (Teilverkauf). Nach jeder Buchung (auch ohne `listing`) zeigt ein Abschluss-Schritt die Erinnerung
// "Auch dort herausnehmen: …" bzw. "Preis für die übrigen Karten anpassen?"; ohne betroffene Angebote schliesst er wie bisher sofort.
export default function SaleDialog({ copyIds, initialGrossCents = null, listing = null, onClose, onBooked, onAdjustListing = null }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState(() => ({ channel_id: 'cardmarket', sold_on: todayLocal(), gross: '', fees: '', shipping: '', note: '', feesTouched: false, grossTouched: false }));
  // Spec H2 §5.2 -- "Neuer Kanal…": Mini-Formular unterhalb der Auswahl, ausserhalb von `form` (kein Buchungsfeld).
  const [addingChannel, setAddingChannel] = useState(false);
  const [newChannel, setNewChannel] = useState({ name: '', fee: '' });
  const [picked, setPicked] = useState(() => new Set(copyIds));
  const [done, setDone] = useState(null); // Antwort von bookSale, solange der Abschluss-Schritt steht

  // Eigener Escape-Handler: solange der Dialog offen ist, soll Escape NUR ihn schliessen, nicht das
  // dahinterliegende CopySheet (das seinen eigenen Handler waehrend sellingOpen aussetzt).
  // Solange der Abschluss-Schritt steht, ist schon gebucht: Escape schliesst dann ueber onBooked.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (done) onBooked?.(done.sale_id); else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onBooked, done]);

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
        setForm((prev) => {
          // Spec H3a §7.1: Kanal des Angebots (nur beim ersten Laden und nur, wenn er noch lebt) -- vor der
          // Gebuehren-Vorbelegung, damit die Gebuehr zum Kanal des Angebots passt.
          const f = listing && !prev.listingChannelApplied && ch.some((c) => c.channel_id === listing.channel_id)
            ? { ...prev, channel_id: listing.channel_id, listingChannelApplied: true } : prev;
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
  // Mit `listing` zaehlen nur die angehakten Karten (Teilverkauf, Spec H3a §7.1); ohne `listing` alles wie in H2.
  const shownItems = useMemo(() => (!preview ? [] : listing ? preview.items.filter((i) => picked.has(i.copy_id)) : preview.items),
    [preview, listing, picked]);
  const market = listing ? shownItems.reduce((a, i) => a + (i.valueCents || 0), 0) : (preview?.marketCents ?? 0);
  const togglePicked = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const book = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.bookSale({ copyIds: listing ? shownItems.map((i) => i.copy_id) : copyIds, channel_id: form.channel_id,
        sold_on: form.sold_on, gross: parse(form.gross), fees: parse(form.fees), shipping: parse(form.shipping), note: form.note,
        listing_id: listing?.listing_id ?? null });
      if (!res?.success) { setError(res?.error || 'Buchen fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      window.dispatchEvent(new Event('listings-dirty'));
      // Spec H3a §7.2 / Abweichung 7: Abschluss-Schritt nur, wenn ein Angebot betroffen ist.
      if ((res.reminders?.length ?? 0) > 0 || res.askAdjust || res.listingSkipped) { setDone({ ...res, reminders: res.reminders || [] }); return; }
      onBooked?.(res.sale_id);
    } catch (e) { setError(e?.message || 'Buchen fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  // Spec H2 §5.2 -- "Neuer Kanal…": anlegen, Kanalliste neu laden (frische Liste `ch`, NICHT den
  // stets um einen Render nachhinkenden `channels`-Zustand -- sonst faende feeOf() den frischen
  // Kanal noch nicht und die Gebuehr wuerde faelschlich 0), neuen Kanal auswaehlen, Gebuehr wie beim
  // ersten Laden nur vorbelegen, wenn sie nicht von Hand geaendert wurde.
  const createChannel = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.saveSaleChannel({ name: newChannel.name, fee_percent: feeValue(newChannel.fee) });
      if (!res?.success) { setError(res?.error || 'Anlegen fehlgeschlagen.'); return; }
      const ch = await window.api.listSaleChannels();
      setChannels(ch);
      setForm((f) => {
        if (f.feesTouched) return { ...f, channel_id: res.channel_id };
        const g = toCents(parse(f.gross)) ?? 0;
        const fee = ch.find((c) => c.channel_id === res.channel_id)?.fee_percent ?? 0;
        return { ...f, channel_id: res.channel_id, fees: toInput(feeDefaultCents(g, fee)) };
      });
      setAddingChannel(false);
      setNewChannel({ name: '', fee: '' });
    } catch (e) { setError(e?.message || 'Anlegen fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  const finish = () => onBooked?.(done.sale_id);
  const dismiss = () => (done ? finish() : onClose?.());
  const openReminder = async (url) => {
    setError(null);
    try {
      const res = await window.api.openListingUrl(url);
      if (!res?.success) setError(res?.error || 'Link konnte nicht geöffnet werden.');
    } catch (e) { setError(e?.message || 'Link konnte nicht geöffnet werden.'); }
  };

  const field = 'w-full bg-obsidian-800 border border-line rounded-lg px-3 py-2 text-sm text-ink';
  return (
    // stopPropagation: ein Klick auf diesen Hintergrund schliesst nur diesen Dialog, nie den darunterliegenden.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={(e) => { e.stopPropagation(); dismiss(); }}>
      <div className="w-full max-w-md bg-obsidian-700 border border-line rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Verkauft buchen</h2>
          <button type="button" onClick={dismiss} className="p-1 text-ink-muted hover:text-ink" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>
        {done ? (
          <>
            <p className="text-sm text-ink">Gebucht.</p>
            {done.listingSkipped && <p className="text-sm text-gold">Angebot war nicht mehr aktiv – nur der Verkauf wurde gebucht.</p>}
            {done.reminders.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-ink">Auch dort herausnehmen:</p>
                {done.reminders.map((r) => (
                  <div key={r.listing_id} className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="flex-1 truncate">{r.channel_name} – {r.title}</span>
                    {r.external_url && <button type="button" onClick={() => openReminder(r.external_url)} className="text-space-violet hover:underline">Anzeige öffnen</button>}
                  </div>
                ))}
              </div>
            )}
            {done.askAdjust && (
              <p className="text-sm text-ink">Preis für die übrigen Karten anpassen?{' '}
                <button type="button" onClick={() => { finish(); onAdjustListing?.(); }} className="text-space-violet hover:underline">Bearbeiten</button>
              </p>
            )}
            {error && <p className="text-sm text-crit">{error}</p>}
            <div className="flex justify-end"><button type="button" onClick={finish} className="px-4 py-2 rounded-lg text-sm bg-space-violet text-white">Fertig</button></div>
          </>
        ) : !preview || !channels ? <p className="text-ink-faint">…</p> : (
          <>
            <p className="text-sm text-ink-muted">{shownItems.length} {shownItems.length === 1 ? 'Karte' : 'Karten'} · Marktwert {euroCentsText(market)}</p>
            {listing && (
              <div className="space-y-1">
                {preview.items.map((i) => (
                  <label key={i.copy_id} className="flex items-center gap-2 text-xs text-ink-muted">
                    <input type="checkbox" checked={picked.has(i.copy_id)} onChange={() => togglePicked(i.copy_id)} />
                    <span className="truncate">{i.name || i.card_id} · {i.set_code} · {i.rarity} · {i.condition}</span>
                  </label>
                ))}
              </div>
            )}
            <label className="block text-xs text-ink-muted">Kanal
              <select className={field} value={form.channel_id} onChange={(e) => {
                // Der Pseudo-Wert oeffnet nur das Mini-Formular und bleibt nie ausgewaehlt:
                // form.channel_id aendert sich hier nicht, also rendert die Auswahl sofort wieder
                // auf dem zuvor gewaehlten echten Kanal.
                if (e.target.value === NEW_CHANNEL) { setAddingChannel(true); return; }
                set({ channel_id: e.target.value });
              }}>
                {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}{c.fee_percent ? ` (${String(c.fee_percent).replace('.', ',')} %)` : ''}</option>)}
                <option value={NEW_CHANNEL}>Neuer Kanal…</option>
              </select>
            </label>
            {addingChannel && (
              <div className="p-3 rounded-lg border border-line bg-obsidian-800 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className={field} placeholder="Name" value={newChannel.name}
                    onChange={(e) => setNewChannel((n) => ({ ...n, name: e.target.value }))} />
                  <input inputMode="decimal" className={field} placeholder="Gebühr %" value={newChannel.fee}
                    onChange={(e) => setNewChannel((n) => ({ ...n, fee: e.target.value }))} />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { setAddingChannel(false); setNewChannel({ name: '', fee: '' }); }}
                    className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink disabled:opacity-50">Abbrechen</button>
                  <button type="button" disabled={busy} onClick={createChannel}
                    className="px-3 py-1.5 rounded-lg text-sm bg-space-violet text-white disabled:opacity-50">{busy ? 'Wird angelegt…' : 'Anlegen'}</button>
                </div>
              </div>
            )}
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
              <button type="button" onClick={book} disabled={busy || shownItems.length === 0}
                className="px-4 py-2 rounded-lg text-sm bg-space-violet text-white disabled:opacity-50">{busy ? 'Wird gebucht…' : 'Buchen'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
