import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import SaleDialog from './SaleDialog';
import ListingDialog from './ListingDialog';
import ListingPhotos from './ListingPhotos';
import { createBusyGate, createLatestOnly } from '../utils/busyGate';
import { todayLocal } from '../utils/today';
import { toCents, euroCentsText } from '../utils/saleMath';
import { EDITION_LABELS } from '../utils/valuation';
import { TITLE_MAX, sinceText, imageUrls, imagesText } from '../utils/listingText';
import { ebayMark } from '../utils/ebayMarks';
import { useEbayData } from '../utils/useEbayData';

const toInput = (v) => { const c = toCents(v); return c == null ? '' : (c / 100).toFixed(2).replace('.', ','); };
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));
const dateText = (iso) => String(iso || '').split('-').reverse().join('.');

// Spec H3a §6 -- Marken einer Angebotszeile (Liste und Detail).
export function ListingMarks({ marks }) {
  if (!marks) return null;
  const chip = 'inline-block text-[10px] px-1.5 py-0.5 rounded';
  return (
    <>
      {marks.alsoOn.length > 0 && <span className={`${chip} bg-warn/15 text-warn`}>auch auf {marks.alsoOn.join(', ')}</span>}
      {marks.missing && <span className={`${chip} bg-bad/20 text-bad`}>Karte fehlt</span>}
      {marks.underSuggestion && <span className={`${chip} bg-warn/15 text-warn`}>Preis unter Vorschlag</span>}
      {marks.saleCancelled && <span className={`${chip} bg-bad/20 text-bad`}>Verkauf storniert</span>}
    </>
  );
}

// Spec H3b §5.4 -- eBay-Marke (Liste und Detail). mark aus ebayMarks.js#ebayMark; onRetry nur im Detail.
export function EbayMark({ mark, onRetry, busy }) {
  if (!mark) return null;
  const chip = 'inline-block text-[10px] px-1.5 py-0.5 rounded';
  const color = mark.kind === 'online' ? 'bg-emerald-500/15 text-emerald-400' : mark.kind === 'fehler' ? 'bg-bad/20 text-bad' : 'bg-warn/15 text-warn';
  return (
    <>
      <span className={`${chip} ${color}`}>{mark.text}</span>
      {mark.retry && onRetry && (
        <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onRetry(); }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-bad/40 text-bad disabled:opacity-50">Erneut versuchen</button>
      )}
    </>
  );
}

// Spec H3a §6/§7/§8 -- ein Angebot: Positionen, Kopieren, Bilder, Link, Bearbeiten, Verkauft, Beenden, Erneut anbieten.
// Geprueft und geschrieben wird im Hauptprozess (listings.cjs); hier nur Anzeige und Aufrufe.
export default function ListingDetail({ listingId, onClose, onChanged, onOpenCard }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [detail, setDetail] = useState(null); // { listing, items } | null = laedt
  const [form, setForm] = useState(null); // null = nicht im Bearbeiten
  const [linkInput, setLinkInput] = useState('');
  const [selling, setSelling] = useState(false);
  const [relist, setRelist] = useState(null); // Vorbelegung aus relistPrefill | null
  const [photoUrls, setPhotoUrls] = useState([]);
  const latest = useRef(createLatestOnly());
  const editing = form != null;
  const ebay = useEbayData();

  // Nur die zuletzt gestartete Abfrage darf setzen (wie CardDetailPanel.loadSold).
  const load = useCallback(() => {
    const token = latest.current.start();
    return window.api.listingDetail({ listing_id: listingId, today: todayLocal() })
      .then((d) => { if (latest.current.isCurrent(token)) setDetail(d); })
      .catch((e) => { if (latest.current.isCurrent(token)) setError(e?.message || 'Angebot konnte nicht geladen werden.'); });
  }, [listingId]);

  useEffect(() => {
    const seq = latest.current;
    load();
    const onDirty = () => { load(); };
    // Wie useListingsData: Angebote, Sammlung und Verkaeufe (anderes Geraet) aendern copyLive/Marktwert.
    const offs = [window.api?.onListingsChanged?.(onDirty), window.api?.onCollectionChanged?.(onDirty), window.api?.onSalesChanged?.(onDirty)];
    window.addEventListener('listings-dirty', onDirty);
    window.addEventListener('collection-dirty', onDirty);
    return () => {
      seq.start();
      offs.forEach((off) => off?.());
      window.removeEventListener('listings-dirty', onDirty);
      window.removeEventListener('collection-dirty', onDirty);
    };
  }, [load]);

  // Eigener Escape-Handler; ausgesetzt, solange ein Dialog darueber offen ist oder bearbeitet wird.
  useEffect(() => {
    if (selling || relist || editing) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selling, relist, editing, onClose]);

  const listing = detail?.listing;
  const items = detail?.items || [];
  const active = listing?.status === 'aktiv';
  const cm = listing?.channel_id === 'cardmarket';
  const liveItems = items.filter((i) => i.copyLive);
  const mark = listing ? ebayMark(listing, ebay.rows[listing.listing_id] ?? null, ebay.status) : null;

  // Nach jeder Schreibaktion: Ereignis, Aufrufer, frisch laden.
  const afterWrite = async () => {
    window.dispatchEvent(new Event('listings-dirty'));
    onChanged?.();
    await load();
  };
  const write = (fn, failText) => gate.run(async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(e?.message || failText); } finally { setBusy(false); }
  });

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice('Kopiert.'); }
    catch { setError('Kopieren fehlgeschlagen.'); }
  };
  const openUrl = async (url) => {
    const res = await window.api.openListingUrl(url);
    if (!res?.success) setError(res?.error || 'Link konnte nicht geöffnet werden.');
  };
  const saveImages = () => write(async () => {
    const res = await window.api.saveListingImages({ title: listing.rowTitle, urls: [...photoUrls, ...imageUrls(items)] });
    if (!res?.success) { setError(res?.error || 'Bilder konnten nicht gespeichert werden.'); return; }
    setNotice(imagesText(res.saved, res.total));
  }, 'Bilder konnten nicht gespeichert werden.');

  // Spec H3b §5.4 -- "Erneut versuchen" bei eBay-Fehler: gleich abgleichen, nicht auf den Zeitplan warten.
  const retryEbay = () => write(async () => {
    const r = await window.api.ebaySyncNow({ retry: listing.listing_id });
    if (!r?.ok) { setError(r?.error || 'eBay-Abgleich fehlgeschlagen.'); return; }
    setNotice(r.busy ? 'Abgleich läuft schon – gleich noch einmal versuchen.' : 'eBay-Abgleich angestoßen.');
    await ebay.reload();
  }, 'eBay-Abgleich fehlgeschlagen.');

  // updateListing ersetzt alle Felder -- immer den vollen Satz schicken (hier: alles ausser dem Link unveraendert).
  const saveLink = () => write(async () => {
    const res = await window.api.updateListing({ listing_id: listing.listing_id, price: listing.price, title: listing.title,
      description: listing.description, external_url: linkInput, note: listing.note, removeCopyIds: [] });
    if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
    setLinkInput('');
    await afterWrite();
  }, 'Speichern fehlgeschlagen.');

  const startEdit = () => {
    setError(null); setNotice(null);
    setForm({ price: toInput(listing.price), title: listing.title || '', description: listing.description || '',
      external_url: listing.external_url || '', note: listing.note || '', remove: [] });
  };
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleRemove = (copyId) => setForm((f) => ({ ...f,
    remove: f.remove.includes(copyId) ? f.remove.filter((x) => x !== copyId) : [...f.remove, copyId] }));
  const saveEdit = () => write(async () => {
    const res = await window.api.updateListing({ listing_id: listing.listing_id, price: parse(form.price), title: form.title,
      description: form.description, external_url: form.external_url, note: form.note, removeCopyIds: form.remove });
    if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
    setForm(null);
    if (res.ended) setNotice('Angebot beendet – keine Karte mehr übrig.');
    await afterWrite();
  }, 'Speichern fehlgeschlagen.');

  // Spec §8 "Karte fehlt": Herausnehmen; leeres Angebot -> beendet.
  const removeItem = (copyId) => write(async () => {
    const res = await window.api.removeListingItems({ listing_id: listing.listing_id, copyIds: [copyId] });
    if (!res?.success) { setError(res?.error || 'Herausnehmen fehlgeschlagen.'); return; }
    if (res.ended) setNotice('Angebot beendet – keine Karte mehr übrig.');
    await afterWrite();
  }, 'Herausnehmen fehlgeschlagen.');

  const end = () => write(async () => {
    if (!window.confirm('Angebot beenden? Die Karten bleiben auf der Verkaufsliste.')) return;
    const res = await window.api.endListing(listing.listing_id);
    if (!res?.success) { setError(res?.error || 'Beenden fehlgeschlagen.'); return; }
    await afterWrite();
  }, 'Beenden fehlgeschlagen.');

  const startRelist = () => write(async () => {
    const prefill = await window.api.relistPrefill(listing.listing_id);
    if (!prefill?.copyIds || prefill.copyIds.length === 0) { setNotice('Keine Karte mehr verfügbar.'); return; }
    setRelist(prefill);
  }, 'Erneut anbieten fehlgeschlagen.');

  const field = 'w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text';
  const btn = 'px-3 py-1.5 rounded-lg text-xs bg-surface-2 border border-line text-text hover:border-accent/40 disabled:opacity-50';

  return (
    // stopPropagation: ein Klick auf diesen Hintergrund schliesst nur dieses Detail.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={(e) => { e.stopPropagation(); onClose?.(); }}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-surface border border-line rounded-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text">Angebot</h2>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-text" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>

        {!listing ? <p className="text-muted">{error || '…'}</p> : (
          <>
            {!editing && (
              <div className="text-sm space-y-1">
                <div className={active ? 'text-text' : 'text-muted'}>
                  {listing.channel_name} · {listing.status} · <span className="font-mono">{dateText(listing.listed_on)}</span> · {sinceText(listing.days)}
                </div>
                <div className="text-text font-bold">{listing.rowTitle}</div>
                <div className="font-mono text-text">{euroCentsText(toCents(listing.price) || 0)}</div>
                <div className="flex flex-wrap items-center gap-1">
                  <ListingMarks marks={listing.marks} />
                  <EbayMark mark={mark} busy={busy} onRetry={retryEbay} />
                </div>
                {listing.note && <div className="text-muted">{listing.note}</div>}
              </div>
            )}

            {editing && (
              <div className="space-y-3">
                <label className="block text-xs text-muted">Preis (€)
                  <input inputMode="decimal" className={field} value={form.price} onChange={(e) => set({ price: e.target.value })} />
                </label>
                {!cm && (
                  <>
                    <label className="block text-xs text-muted">Titel
                      <input className={field} value={form.title} onChange={(e) => set({ title: e.target.value })} />
                    </label>
                    <p className={form.title.length > TITLE_MAX ? 'text-xs text-bad' : 'text-xs text-muted'}>{form.title.length}/{TITLE_MAX}</p>
                    <label className="block text-xs text-muted">Beschreibung
                      <textarea rows={6} className={field} value={form.description} onChange={(e) => set({ description: e.target.value })} />
                    </label>
                  </>
                )}
                <label className="block text-xs text-muted">Link der Anzeige (optional)
                  <input className={field} value={form.external_url} onChange={(e) => set({ external_url: e.target.value })} />
                </label>
                <label className="block text-xs text-muted">Notiz
                  <input className={field} value={form.note} onChange={(e) => set({ note: e.target.value })} />
                </label>
              </div>
            )}

            <div className="space-y-2">
              {items.length === 0 && <p className="text-sm text-muted">Keine Karten.</p>}
              {items.map((it) => (
                <div key={it.copy_id} className="flex items-center gap-3 p-2 rounded-lg border border-line">
                  <button type="button" onClick={() => { onClose?.(); onOpenCard?.(it); }} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                    {it.image_url ? <img src={it.image_url} alt="" className="w-10 h-14 object-cover rounded" /> : <div className="w-10 h-14 rounded bg-bg shrink-0" />}
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="text-text truncate">{it.name || it.card_id}</div>
                      <div className="text-[11px] font-mono text-muted">{it.set_code} · {it.rarity} · {it.language}</div>
                      <div className="text-[11px] font-mono text-muted">{it.condition} · {EDITION_LABELS[it.edition] || it.edition}</div>
                    </div>
                    {/* Verkauft/beendet: Exemplare sind verkauft (sold_in) -- dort kein "Marktwert –" und kein "Karte fehlt". */}
                    {(active || it.marketCents != null) && (
                      <div className="text-right text-[11px] font-mono text-muted shrink-0">
                        Marktwert {it.marketCents == null ? '–' : euroCentsText(it.marketCents)}
                      </div>
                    )}
                  </button>
                  {!it.copyLive && active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-bad/20 text-bad shrink-0">Karte fehlt</span>}
                  {!it.copyLive && active && !editing && (
                    <button type="button" onClick={() => removeItem(it.copy_id)} disabled={busy} className={btn}>Herausnehmen</button>
                  )}
                  {editing && (
                    <label className="flex items-center gap-1 text-xs text-muted shrink-0">
                      <input type="checkbox" checked={form.remove.includes(it.copy_id)} onChange={() => toggleRemove(it.copy_id)} /> herausnehmen
                    </label>
                  )}
                </div>
              ))}
            </div>

            <ListingPhotos listingId={listing.listing_id} onChanged={(ps) => setPhotoUrls(ps.map((p) => p.url))} />

            {!editing && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {!cm && (
                    <>
                      <button type="button" disabled={!listing.title} onClick={() => copyText(listing.title)} className={btn}>Titel kopieren</button>
                      <button type="button" disabled={!listing.description} onClick={() => copyText(listing.description)} className={btn}>Beschreibung kopieren</button>
                    </>
                  )}
                  <button type="button" disabled={busy} onClick={saveImages} className={btn}>Bilder</button>
                  {listing.external_url && <button type="button" onClick={() => openUrl(listing.external_url)} className={btn}>Anzeige öffnen</button>}
                  {mark?.url && <button type="button" onClick={() => openUrl(mark.url)} className={btn}>Auf eBay ansehen</button>}
                </div>
                <p className="text-muted text-xs">Eigene Fotos gehen vor dem Katalogbild zu eBay und in „Bilder“.</p>
                {!listing.external_url && active && (
                  <div className="flex gap-2">
                    <input className={field} placeholder="Link der Anzeige" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} />
                    <button type="button" disabled={busy || linkInput.trim() === ''} onClick={saveLink} className={`${btn} shrink-0`}>Link speichern</button>
                  </div>
                )}
              </div>
            )}

            {active && !editing && liveItems.length === 0 && (
              <p className="text-sm text-bad">Keine verkaufbare Karte – bitte herausnehmen oder beenden.</p>
            )}
            {notice && <p className="text-sm text-emerald-400">{notice}</p>}
            {error && <p className="text-sm text-bad">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              {active && editing && (
                <>
                  <button type="button" onClick={() => { setForm(null); setError(null); }} className="px-3 py-2 text-sm text-muted hover:text-text">Abbrechen</button>
                  <button type="button" onClick={saveEdit} disabled={busy}
                    className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50">{busy ? 'Wird gespeichert…' : 'Speichern'}</button>
                </>
              )}
              {active && !editing && (
                <>
                  <button type="button" onClick={end} disabled={busy}
                    className="px-3 py-2 rounded-lg text-sm border border-bad/40 text-bad hover:bg-bad/10 disabled:opacity-50">Beenden</button>
                  <button type="button" onClick={startEdit} disabled={busy}
                    className="px-3 py-2 rounded-lg text-sm bg-surface-2 border border-line text-text disabled:opacity-50">Bearbeiten</button>
                  <button type="button" onClick={() => setSelling(true)} disabled={busy || liveItems.length === 0}
                    className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50">Verkauft</button>
                </>
              )}
              {!active && (
                <button type="button" onClick={startRelist} disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50">Erneut anbieten</button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Verschachtelte Dialoge: Klicks (auch auf ihren Hintergrund) enden hier und schliessen nie das Detail mit. */}
      <div onClick={(e) => e.stopPropagation()}>
        {selling && <SaleDialog copyIds={liveItems.map((i) => i.copy_id)} initialGrossCents={toCents(listing.price)}
          listing={{ listing_id: listing.listing_id, channel_id: listing.channel_id, priceCents: toCents(listing.price) }}
          onClose={() => setSelling(false)} onBooked={() => { setSelling(false); onChanged?.(); load(); }} onAdjustListing={startEdit} />}
        {relist && <ListingDialog copyIds={relist.copyIds} prefill={relist} onClose={() => setRelist(null)}
          onSaved={() => { setRelist(null); onChanged?.(); load(); }} />}
      </div>
    </div>
  );
}
