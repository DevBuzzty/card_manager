import { useEffect, useRef, useState } from 'react';
import { X, Trash2, AlertCircle } from 'lucide-react';
import { parseTags, addTag, removeTag } from '../utils/tags';
import { EDITION_LABELS } from '../utils/valuation';
import { KIND_LABELS } from '../utils/containerKinds';
import { suggestionCents, normalizeDiscount, normalizeMinPrice } from '../utils/saleMath';
import SaleDialog from './SaleDialog';
import ListingDialog from './ListingDialog';

// Spec B1 §7.3: Das Exemplar-Sheet ist die EINZIGE Stelle, an der Standort, Tags und Notiz eines
// Exemplars geschrieben werden -- kein zweiter Schreibweg irgendwo sonst. Gleiche Ueberlagerung,
// Schliessen-Geste und Tailwind-Klassen wie CardSearchModal.jsx/RarityGuide.jsx; die
// Doppelklick-Sperre (Ref, synchron vor dem ersten await) und die Fehleranzeige folgen dem in
// Binders.jsx erprobten Muster, statt das hier neu zu erfinden.
//
// Tags laufen ausschliesslich ueber parseTags/addTag/removeTag aus ../utils/tags.js. serializeTags
// wird hier bewusst NICHT verwendet: window.api.setCopyTagsNote (electron/copies.cjs) erwartet im
// `tags`-Feld das rohe string[] -- die Funktion normalisiert und serialisiert selbst noch einmal
// (siehe copies.cjs#normalizeTagList/#setCopyTagsNote sowie deren Tests in
// copies-location.test.cjs, die durchweg ein Array uebergeben). Ein bereits von serializeTags
// erzeugter JSON-String faellt dort durch `Array.isArray(tags)` und wuerde als leere Liste
// gespeichert -- die Tags waeren nach jedem Speichern weg.
export default function CopySheet({ copy, onClose, onSaved }) {
  const [containers, setContainers] = useState([]);
  const [tagSuggestions, setTagSuggestions] = useState([]);
  const [containerId, setContainerId] = useState(copy?.container_id || '');
  const [page, setPage] = useState(copy?.page ?? '');
  const [slot, setSlot] = useState(copy?.slot ?? '');
  const [tags, setTags] = useState(() => parseTags(copy?.tags));
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState(copy?.note || '');
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null); // Lade- oder Umsortierfehler -- eigener Zustand, gleiche Bauart wie Binders.jsx
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Spec H1 §5.3: Schalter "Zum Verkauf" schreibt sofort (eigener Knopfzustand, dasselbe busyRef wie Speichern/Entfernen).
  const [forSale, setForSale] = useState(!!copy?.for_sale);
  const [markingSale, setMarkingSale] = useState(false);
  // Spec H2 §5.1: Spontanverkauf direkt aus dem Sheet, unabhaengig von "Zum Verkauf".
  const [sellingOpen, setSellingOpen] = useState(false);
  // Spec H3a §5.1: Angebot direkt aus dem Sheet anlegen.
  const [listingOpen, setListingOpen] = useState(false);
  // Spec H2 §9 -- Preisvorschlag als Vorbelegung des Buchungsdialogs. copy traegt hier keine
  // Preisfelder (copies.cjs#listCopies/#listAllCopies liefern nur die Exemplarspalten), daher der
  // Umweg ueber previewSale (denselben Marktwert, den SaleDialog sonst selbst nachlaedt); die
  // Einstellungen laedt das Sheet selbst, nach demselben Muster wie ForSaleList.jsx.
  const [saleInitialCents, setSaleInitialCents] = useState(null);
  const busyRef = useRef(false); // gleiche Bauart wie Binders.jsx's savingRef -- wirkt synchron, eine State-Flag kaeme zu spaet gegen einen zweiten Klick

  useEffect(() => {
    let alive = true;
    if (!copy?.copy_id) return undefined;
    Promise.all([window.api?.getSettings?.() ?? {}, window.api?.previewSale?.([copy.copy_id]) ?? null])
      .then(([s, pv]) => {
        if (!alive || !pv) return;
        const rule = { discount: normalizeDiscount(s?.sale_discount_percent), minCents: normalizeMinPrice(s?.sale_min_price) };
        setSaleInitialCents(suggestionCents(pv.marketCents, rule.discount, rule.minCents));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [copy?.copy_id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, t] = await Promise.all([
          window.api?.listContainers?.() ?? [],
          window.api?.listTags?.() ?? [],
        ]);
        if (!alive) return;
        setContainers(Array.isArray(c) ? c : []);
        setTagSuggestions(Array.isArray(t) ? t : []);
        setLoadError(null);
      } catch (e) {
        // list-containers/list-tags werfen bei einem DB-Fehler statt {success:false} zu liefern
        // (main.cjs). Anders als bei CardDetailPanel.jsx (dort faellt der Standort-Chip defensiv
        // auf „—" zurueck) MUSS das hier sichtbar sein: eine leer gebliebene Behaelterliste macht
        // isBinder faelschlich false, und ein Speichern danach loescht den echten Standort still
        // (Befund B) -- gleiche Anzeige wie Binders.jsx.
        if (!alive) return;
        setLoadError(e?.message || 'Behälter und Tags konnten nicht geladen werden.');
      }
    })();
    return () => { alive = false; };
  }, []);

  // Waehrend das Sheet offen ist, soll Escape nur das Sheet schliessen -- nicht (zusaetzlich)
  // die dahinterliegende CardDetailPanel-Ansicht, die selbst einen globalen Escape-Handler hat.
  // Solange SaleDialog obendrauf offen ist, gehoert Escape IHM (eigener Handler dort) -- sonst
  // wuerde ein Druck das ganze Sheet schliessen und den laufenden Verkaufs-Dialog mit wegreissen
  // (gleiches Muster wie CardDetailPanel.jsx: paletteOpen/sheetCopy).
  useEffect(() => {
    if (sellingOpen || listingOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sellingOpen, listingOpen]);

  const selectedContainer = containers.find(c => c.container_id === containerId);
  const isBinder = selectedContainer?.kind === 'binder';

  // Box/Deckbox haben keine Seiten -- setCopyLocation verwirft page/slot dort ohnehin
  // (electron/copies.cjs), die Oberflaeche soll aber nicht erst anbieten, was verworfen wird.
  const onContainerChange = (id) => {
    setContainerId(id);
    const c = containers.find(x => x.container_id === id);
    if (!c || c.kind !== 'binder') { setPage(''); setSlot(''); }
  };

  const commitTagInput = () => {
    const t = tagInput.trim();
    if (!t) return;
    setTags(list => addTag(list, t));
    setTagInput('');
  };

  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      // Ein eingetippter, aber nicht per Enter bestaetigter Tag geht sonst verloren: tagInput
      // lebt nur im Eingabefeld, save() schickte bisher ausschliesslich den tags-Zustand. VOR dem
      // ersten await uebernehmen (synchron, wie busyRef oben) und DIESE Liste senden -- der
      // spaetere setTags-Aufruf aus commitTagInput() kaeme erst nach dem Speichern und damit zu spaet.
      const t = tagInput.trim();
      const tagsToSave = t ? addTag(tags, t) : tags;
      // page/slot gehen ROH mit -- setCopyLocation (electron/copies.cjs) verwirft sie bei
      // Nicht-Bindern bereits selbst anhand der Behaelterart in der Datenbank. Die Regel liegt
      // dort und nicht hier, damit sie fuer jeden Aufrufer gilt (Befund B): ein clientseitiges
      // `isBinder &&` wuerde faelschlich `false` sein, solange containers noch laedt oder das
      // Laden fehlgeschlagen ist, und dann Seite/Fach eines echten Ordner-Exemplars loeschen.
      const locResult = await window.api?.setCopyLocation?.({
        copy_id: copy.copy_id,
        container_id: containerId || null,
        page: page !== '' ? Number(page) : null,
        slot: slot !== '' ? Number(slot) : null,
      });
      if (locResult && locResult.success === false) {
        setError(locResult.error || 'Speichern fehlgeschlagen.');
        return;
      }
      const notResult = await window.api?.setCopyTagsNote?.({
        copy_id: copy.copy_id,
        tags: tagsToSave,
        note: note.trim() === '' ? null : note,
      });
      if (notResult && notResult.success === false) {
        setError(notResult.error || 'Speichern fehlgeschlagen.');
        return;
      }
      onSaved?.();
      onClose?.();
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const toggleForSale = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setMarkingSale(true);
    setError(null);
    try {
      const next = !forSale;
      const result = await window.api?.setForSale?.({ copyIds: [copy.copy_id], value: next });
      if (!result?.success) {
        setError(result?.error || 'Speichern fehlgeschlagen.');
        return;
      }
      setForSale(next);
      onSaved?.();
    } finally {
      busyRef.current = false;
      setMarkingSale(false);
    }
  };

  // Copy_id-genau ueber deleteCopy, NICHT removeCopy: removeCopy waehlt ueber Edition/Zustand/
  // Erstellzeit aus einer ganzen Gruppe aus, ohne Ruecksicht auf Standort/Tags/Notiz des
  // einzelnen Exemplars (Befund A) -- hier im Sheet ist aber genau EIN Exemplar (copy.copy_id)
  // gemeint, das der Nutzer gerade vor sich hat.
  const removeExemplar = async () => {
    if (busyRef.current) return;
    if (!confirm('Dieses Exemplar entfernen?')) return;
    busyRef.current = true;
    setRemoving(true);
    setError(null);
    try {
      const result = await window.api?.deleteCopy?.({ copy_id: copy.copy_id });
      if (!result?.success) {
        setError(result?.error || 'Entfernen fehlgeschlagen.');
        return;
      }
      onSaved?.();
      onClose?.();
    } finally {
      busyRef.current = false;
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-surface w-full max-w-md max-h-[85vh] rounded-2xl border border-line shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-line flex justify-between items-center bg-surface-2">
          <div>
            <h2 className="text-xl font-bold text-text">Exemplar</h2>
            <p className="text-xs text-muted font-mono mt-0.5">
              {copy.set_code} · {copy.rarity} · {EDITION_LABELS[copy.edition] || copy.edition} · {copy.condition}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-full text-muted hover:text-text transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
          {loadError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Standort</label>
            <select
              value={containerId}
              onChange={e => onContainerChange(e.target.value)}
              className="w-full bg-bg/40 border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              <option value="">Kein Behälter</option>
              {containers.map(c => (
                <option key={c.container_id} value={c.container_id}>{c.name} ({KIND_LABELS[c.kind] || c.kind})</option>
              ))}
            </select>
            {isBinder && (
              <div className="flex gap-2 mt-2">
                <input type="number" min="1" placeholder="Seite" value={page} onChange={e => setPage(e.target.value)}
                  className="w-1/2 bg-bg/40 border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
                <input type="number" min="1" placeholder="Fach" value={slot} onChange={e => setSlot(e.target.value)}
                  className="w-1/2 bg-bg/40 border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Tags</label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(t => (
                  <span key={t} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-accent/20 text-text rounded-full text-xs font-medium border border-accent/30">
                    {t}
                    <button type="button" onClick={() => setTags(list => removeTag(list, t))} className="hover:text-text">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              list="copy-sheet-tag-suggestions"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitTagInput(); } }}
              placeholder="Tag eingeben, Enter zum Anlegen…"
              className="w-full bg-bg/40 border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
            <datalist id="copy-sheet-tag-suggestions">
              {tagSuggestions.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>

          <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">Zum Verkauf</span>
            <input type="checkbox" role="switch" checked={forSale} disabled={markingSale || saving || removing}
              onChange={toggleForSale} className="accent-accent w-4 h-4" />
          </label>

          <div>
            <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Notiz</label>
            <textarea
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full bg-bg/40 border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {error && <p className="text-sm text-bad">{error}</p>}
        </div>

        <div className="p-6 border-t border-line bg-surface-2 flex items-center justify-between">
          <div className="flex gap-2">
            <button type="button" onClick={removeExemplar} disabled={removing || saving || markingSale}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-bad hover:bg-bad/10 rounded-lg transition-colors disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> {removing ? 'Wird entfernt…' : 'Entfernen'}
            </button>
            {copy?.copy_id && (
              <button type="button" onClick={() => setSellingOpen(true)} disabled={saving || removing || markingSale}
                className="px-3 py-2 text-sm text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50">
                Verkauft…
              </button>
            )}
            {copy?.copy_id && (
              <button type="button" onClick={() => setListingOpen(true)} disabled={saving || removing || markingSale}
                className="px-3 py-2 text-sm text-muted hover:text-text rounded-lg transition-colors disabled:opacity-50">
                Anbieten…
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-muted hover:text-text transition-colors">Abbrechen</button>
            <button type="button" onClick={save} disabled={saving || removing || markingSale}
              className="px-4 py-2 rounded-lg bg-accent hover:brightness-110 text-accent-fg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Wird gespeichert…' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
      {sellingOpen && (
        <SaleDialog copyIds={[copy.copy_id]} initialGrossCents={saleInitialCents} onClose={() => setSellingOpen(false)} onBooked={() => { setSellingOpen(false); onSaved?.(); onClose?.(); }} />
      )}
      {listingOpen && (
        <ListingDialog copyIds={[copy.copy_id]} onClose={() => setListingOpen(false)} onSaved={() => { setListingOpen(false); setForSale(true); onSaved?.(); }} />
      )}
    </div>
  );
}
