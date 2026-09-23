import { useCallback, useEffect, useRef, useState } from 'react';
import { createBusyGate, createLatestOnly } from '../utils/busyGate';
import { MAX_OWN_PHOTOS, photoCountText } from '../utils/ebayMarks';

// Spec H3b1 §6 -- eigene Fotos je Angebot: Vorschau, Reihenfolge (tauscht mit dem Nachbarn), entfernen (weich),
// hinzufügen über den Datei-Dialog im Hauptprozess. photos === null = lädt. Lädt neu beim Einhängen, bei
// onListingsChanged (anderes Geraet/Fenster) und nach jeder eigenen Aktion; die zuletzt gestartete Abfrage gewinnt.
export default function ListingPhotos({ listingId, onChanged }) {
  const [photos, setPhotos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [gate] = useState(createBusyGate);
  const latest = useRef(createLatestOnly());

  const load = useCallback(() => {
    const token = latest.current.start();
    return window.api.listingPhotos(listingId)
      .then((ps) => { if (latest.current.isCurrent(token)) { setPhotos(ps || []); onChanged?.(ps || []); } })
      .catch(() => { if (latest.current.isCurrent(token)) setError('Fotos konnten nicht geladen werden.'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  useEffect(() => {
    const seq = latest.current;
    load();
    const off = window.api?.onListingsChanged?.(() => load());
    return () => { seq.start(); off?.(); };
  }, [load]);

  const run = (fn) => gate.run(async () => {
    setBusy(true); setError(null);
    try { await fn(); } finally { setBusy(false); }
  });

  const swap = (i, j) => run(async () => {
    const ids = photos.map((p) => p.photo_id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const r = await window.api.reorderListingPhotos({ listing_id: listingId, photoIds: ids });
    if (!r?.success) { setError(r?.error || 'Speichern fehlgeschlagen.'); return; }
    await load();
  });
  const remove = (photoId) => run(async () => {
    if (!window.confirm('Foto entfernen?')) return;
    const r = await window.api.deleteListingPhoto(photoId);
    if (!r?.success) { setError(r?.error || 'Speichern fehlgeschlagen.'); return; }
    await load();
  });
  const add = () => run(async () => {
    const r = await window.api.addListingPhotos(listingId);
    if (r?.error) { setError(r.error); return; }
    if ((r?.added || 0) > 0) await load();
  });

  const btn = 'px-2 py-1 rounded-lg text-xs bg-surface-2 border border-line text-text hover:border-accent/40 disabled:opacity-50';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted uppercase tracking-wider">Eigene Fotos {photos && `(${photoCountText(photos.length)})`}</label>
        <button type="button" disabled={busy || !photos || photos.length >= MAX_OWN_PHOTOS} onClick={add} className={btn}>Fotos hinzufügen</button>
      </div>
      {photos === null ? <p className="text-sm text-muted">…</p> : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.photo_id} className="relative w-16 h-16 shrink-0">
              <img src={p.url} alt="" className="w-16 h-16 object-cover rounded border border-line" />
              <div className="absolute inset-x-0 bottom-0 flex justify-between px-0.5 pb-0.5">
                <button type="button" disabled={busy || i === 0} onClick={() => swap(i, i - 1)} className="text-[10px] px-1 rounded bg-black/60 text-white disabled:opacity-30">←</button>
                <button type="button" disabled={busy} onClick={() => remove(p.photo_id)} className="text-[10px] px-1 rounded bg-black/60 text-bad">✕</button>
                <button type="button" disabled={busy || i === photos.length - 1} onClick={() => swap(i, i + 1)} className="text-[10px] px-1 rounded bg-black/60 text-white disabled:opacity-30">→</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
