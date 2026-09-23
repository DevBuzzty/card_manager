import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { toCents, suggestionCents, euroCentsText } from '../utils/saleMath';
import { todayLocal } from '../utils/today';
import {
  TITLE_MAX, groupItems, listingTitle, listingDescription, cardmarketProduct, cardmarketEntry, listingLink,
  suggestionSum, imageUrls, imagesText,
} from '../utils/listingText';
import { setupOk } from '../utils/ebayMarks';
import { useEbayData } from '../utils/useEbayData';

const toInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));
const groupKey = (g) => g.copy_ids.join(',');

// Spec H3a §5.2–§5.7 -- Angebot erstellen, auch "Erneut anbieten" (prefill). Geprueft und gespeichert wird im
// Hauptprozess (listings.cjs); hier nur Vorschau, Texte (Zwilling listingText.js), Kopieren, Link, Bilder.
export default function ListingDialog({ copyIds, prefill = null, onClose, onSaved }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [channels, setChannels] = useState(null);
  const [preview, setPreview] = useState(null); // { items, missing, rule }
  const [form, setForm] = useState(() => ({
    channel_id: prefill?.channel_id ?? 'cardmarket', listed_on: todayLocal(),
    price: prefill?.priceCents != null ? toInput(prefill.priceCents) : '', priceTouched: prefill?.priceCents != null,
    title: prefill?.title ?? '', titleTouched: prefill?.title != null,
    description: prefill?.description ?? '', descTouched: prefill?.description != null,
    external_url: '', note: '',
  }));
  const [cmPrices, setCmPrices] = useState({}); // groupKey -> Eingabe, erst nach einer Aenderung gesetzt
  const ebay = useEbayData();

  // Eigener Escape-Handler; der Aufrufer (CopySheet, ListingDetail) setzt seinen aus, solange der Dialog offen ist.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // idsKey statt copyIds: CopySheet uebergibt ein Inline-Array (neue Referenz je Rendern), siehe SaleDialog.jsx.
  const idsKey = copyIds.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all([window.api.listSaleChannels(), window.api.previewListing(copyIds)])
      .then(([ch, pv]) => {
        if (!alive) return;
        setChannels(ch);
        setPreview(pv);
        setForm((f) => {
          const next = { ...f };
          // Ausgeblendeter Kanal (Erneut anbieten): neue Angebote nur auf lebenden Kanaelen (Spec §8).
          if (!ch.some((c) => c.channel_id === f.channel_id)) next.channel_id = ch[0]?.channel_id ?? f.channel_id;
          if (!f.priceTouched) {
            next.price = toInput(suggestionSum(pv.items.map((it) => suggestionCents(it.valueCents, pv.rule.discount, pv.rule.minCents))));
          }
          return next;
        });
      })
      .catch((e) => { if (alive) setError(e?.message || 'Laden fehlgeschlagen.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const items = useMemo(() => preview?.items ?? [], [preview]);
  const groups = useMemo(() => groupItems(items), [items]);
  const cm = form.channel_id === 'cardmarket';
  const suggestionOf = (it) => suggestionCents(it.valueCents, preview.rule.discount, preview.rule.minCents);
  const itemsOf = (g) => items.filter((it) => g.copy_ids.includes(it.copy_id));
  const cmPriceInput = (g) => cmPrices[groupKey(g)] ?? toInput(suggestionSum(itemsOf(g).map(suggestionOf)));
  const priceCents = toCents(parse(form.price));
  const title = form.titleTouched ? form.title : listingTitle(items);
  const description = form.descTouched ? form.description : listingDescription(items, priceCents);
  const canSave = !busy && items.length > 0 && (cm
    ? groups.every((g) => (toCents(parse(cmPriceInput(g))) ?? 0) > 0)
    : (priceCents ?? 0) > 0);

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice('Kopiert.'); }
    catch { setError('Kopieren fehlgeschlagen.'); }
  };
  const openUrl = async (url) => {
    const res = await window.api.openListingUrl(url);
    if (!res?.success) setError(res?.error || 'Link konnte nicht geöffnet werden.');
  };
  const saveImages = (folderTitle, its) => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.saveListingImages({ title: folderTitle, urls: imageUrls(its) });
      if (!res?.success) { setError(res?.error || 'Bilder konnten nicht gespeichert werden.'); return; }
      setNotice(imagesText(res.saved, res.total));
    } catch (e) { setError(e?.message || 'Bilder konnten nicht gespeichert werden.'); }
    finally { setBusy(false); }
  });

  const save = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const head = { channel_id: form.channel_id, listed_on: form.listed_on, external_url: form.external_url, note: form.note };
      // Spec §5.4: Cardmarket = ein Angebot je Gruppe, vor dem Speichern geteilt.
      const listings = cm
        ? groups.map((g) => ({ ...head, copyIds: g.copy_ids, price: parse(cmPriceInput(g)), title: null, description: null }))
        : [{ ...head, copyIds: items.map((it) => it.copy_id), price: parse(form.price), title, description }];
      const res = await window.api.createListings({ listings });
      if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      window.dispatchEvent(new Event('listings-dirty'));
      onSaved?.(res.listing_ids);
    } catch (e) { setError(e?.message || 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  const field = 'w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text';
  const btn = 'px-3 py-1.5 rounded-lg text-xs bg-surface-2 border border-line text-text hover:border-accent/40 disabled:opacity-50';
  const marketCents = items.reduce((a, it) => a + (it.valueCents || 0), 0);

  return (
    // stopPropagation: ein Klick auf diesen Hintergrund schliesst nur diesen Dialog, nie den darunterliegenden (wie SaleDialog).
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-lg bg-surface border border-line rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text">{prefill ? 'Erneut anbieten' : 'Angebot erstellen'}</h2>
          <button type="button" onClick={onClose} className="p-1 text-muted hover:text-text" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>
        {!preview || !channels ? <p className="text-muted">…</p> : (
          <>
            <p className="text-sm text-muted">{items.length} {items.length === 1 ? 'Karte' : 'Karten'} · Marktwert {euroCentsText(marketCents)}</p>
            {preview.missing.length > 0 && (
              <p className="text-sm text-bad">{preview.missing.length} {preview.missing.length === 1 ? 'Karte' : 'Karten'} nicht mehr verfügbar – werden nicht angeboten.</p>
            )}
            {items.filter((it) => it.alsoOn.length > 0).map((it) => (
              <p key={it.copy_id} className="text-sm text-warn">{it.name} – auch auf {it.alsoOn.join(', ')} eingestellt</p>
            ))}
            <label className="block text-xs text-muted">Kanal
              <select className={field} value={form.channel_id} onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))}>
                {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted">Datum
              <input type="date" className={field} value={form.listed_on} onChange={(e) => setForm((f) => ({ ...f, listed_on: e.target.value }))} />
            </label>
            {!cm && (
              <>
                <label className="block text-xs text-muted">Preis (€)
                  <input inputMode="decimal" className={field} value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value, priceTouched: true }))} />
                </label>
                <label className="block text-xs text-muted">Titel
                  <input className={field} value={title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value, titleTouched: true }))} />
                </label>
                <p className={title.length > TITLE_MAX ? 'text-xs text-bad' : 'text-xs text-muted'}>{title.length}/{TITLE_MAX}</p>
                <label className="block text-xs text-muted">Beschreibung
                  <textarea rows={6} className={field} value={description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value, descTouched: true }))} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => copyText(title)} className={btn}>Titel kopieren</button>
                  <button type="button" onClick={() => copyText(description)} className={btn}>Beschreibung kopieren</button>
                  {listingLink(form.channel_id, {}) != null && (
                    <button type="button" disabled={busy} onClick={() => openUrl(listingLink(form.channel_id, {}))} className={btn}>Zum Einstellen öffnen</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => saveImages(title || 'Angebot', items)} className={btn}>Bilder</button>
                </div>
              </>
            )}
            {cm && (
              <div className="space-y-3">
                {groups.length > 1 && <p className="text-sm text-muted">wird zu {groups.length} Cardmarket-Angeboten</p>}
                {groups.map((g) => {
                  const gk = groupKey(g);
                  const priceInput = cmPriceInput(g);
                  const entry = cardmarketEntry(g, toCents(parse(priceInput)));
                  const first = itemsOf(g)[0];
                  const link = listingLink('cardmarket', { cmUrl: first?.cm_url, nameEn: first?.name_en, setCode: g.set_code });
                  return (
                    <div key={gk} className="p-3 rounded-lg border border-line bg-bg space-y-2">
                      <div className="text-sm text-text">{entry.product}</div>
                      <div className="text-xs text-muted">Menge {entry.quantity} · {entry.language} · {entry.condition} · 1. Auflage: {entry.firstEdition ? 'ja' : 'nein'}</div>
                      <div className="text-xs text-muted">Preis je Stück: {entry.pieceCents == null ? '–' : euroCentsText(entry.pieceCents)}</div>
                      <label className="block text-xs text-muted">Preis (€)
                        <input inputMode="decimal" className={field} value={priceInput}
                          onChange={(e) => setCmPrices((p) => ({ ...p, [gk]: e.target.value }))} />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {link != null && <button type="button" disabled={busy} onClick={() => openUrl(link)} className={btn}>Zum Einstellen öffnen</button>}
                        <button type="button" disabled={busy} onClick={() => saveImages(`${g.count}× ${cardmarketProduct(g)}`, itemsOf(g))} className={btn}>Bilder</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <label className="block text-xs text-muted">Link der Anzeige (optional)
              <input className={field} value={form.external_url} onChange={(e) => setForm((f) => ({ ...f, external_url: e.target.value }))} />
            </label>
            <label className="block text-xs text-muted">Notiz
              <input className={field} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </label>
            <p className="text-muted text-xs">Eigene Fotos fügst du nach dem Speichern im Angebot hinzu.</p>
            {form.channel_id === 'ebay' && ebay.status !== undefined && !setupOk(ebay.status) && (
              <p className="text-sm text-warn">eBay ist noch nicht eingerichtet – das Angebot wartet, bis der Check in den Einstellungen vollständig ist.</p>
            )}
            {notice && <p className="text-sm text-emerald-400">{notice}</p>}
            {error && <p className="text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-muted hover:text-text">Abbrechen</button>
              <button type="button" onClick={save} disabled={!canSave}
                className="px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50">{busy ? 'Wird gespeichert…' : 'Angebot speichern'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
