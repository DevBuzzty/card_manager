import { useEffect, useRef, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { parseTags, addTag, removeTag } from '../utils/tags';
import { EDITION_LABELS } from '../utils/valuation';

const KIND_LABELS = { binder: 'Ordner', box: 'Box', deckbox: 'Deckbox' };

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
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const busyRef = useRef(false); // gleiche Bauart wie Binders.jsx's savingRef -- wirkt synchron, eine State-Flag kaeme zu spaet gegen einen zweiten Klick

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
      } catch {
        // list-containers/list-tags werfen bei einem DB-Fehler statt {success:false} zu liefern
        // (main.cjs) -- Behaelterauswahl/Vorschlaege bleiben dann schlicht leer, kein eigener
        // Fehlertext dafuer (Standort/Tags sind hier nicht die einzige Funktion des Sheets).
      }
    })();
    return () => { alive = false; };
  }, []);

  // Waehrend das Sheet offen ist, soll Escape nur das Sheet schliessen -- nicht (zusaetzlich)
  // die dahinterliegende CardDetailPanel-Ansicht, die selbst einen globalen Escape-Handler hat.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      const locResult = await window.api?.setCopyLocation?.({
        copy_id: copy.copy_id,
        container_id: containerId || null,
        page: isBinder && page !== '' ? Number(page) : null,
        slot: isBinder && slot !== '' ? Number(slot) : null,
      });
      if (locResult && locResult.success === false) {
        setError(locResult.error || 'Speichern fehlgeschlagen.');
        return;
      }
      const notResult = await window.api?.setCopyTagsNote?.({
        copy_id: copy.copy_id,
        tags,
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

  // In B1 gibt es keinen Vorschlag fuer das naechste freie Fach (SlotMath kommt erst in B2) --
  // Seite/Fach hier leer zu lassen ist zulaessig.
  const removeExemplar = async () => {
    if (busyRef.current) return;
    if (!confirm('Dieses Exemplar entfernen?')) return;
    busyRef.current = true;
    setRemoving(true);
    setError(null);
    try {
      const result = await window.api?.removeCopy?.({
        id: copy.card_id, set_code: copy.set_code, language: copy.language || 'DE', rarity: copy.rarity,
        edition: copy.edition, condition: copy.condition, count: 1,
      });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-[#1E1E1E] w-full max-w-md max-h-[85vh] rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-[#252525]">
          <div>
            <h2 className="text-xl font-bold text-white">Exemplar</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">
              {copy.set_code} · {copy.rarity} · {EDITION_LABELS[copy.edition] || copy.edition} · {copy.condition}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Standort</label>
            <select
              value={containerId}
              onChange={e => onContainerChange(e.target.value)}
              className="w-full bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet"
            >
              <option value="">Kein Behälter</option>
              {containers.map(c => (
                <option key={c.container_id} value={c.container_id}>{c.name} ({KIND_LABELS[c.kind] || c.kind})</option>
              ))}
            </select>
            {isBinder && (
              <div className="flex gap-2 mt-2">
                <input type="number" min="1" placeholder="Seite" value={page} onChange={e => setPage(e.target.value)}
                  className="w-1/2 bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet" />
                <input type="number" min="1" placeholder="Fach" value={slot} onChange={e => setSlot(e.target.value)}
                  className="w-1/2 bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Tags</label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(t => (
                  <span key={t} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-space-violet/20 text-space-violet rounded-full text-xs font-medium border border-space-violet/30">
                    {t}
                    <button type="button" onClick={() => setTags(list => removeTag(list, t))} className="hover:text-white">
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
              className="w-full bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet"
            />
            <datalist id="copy-sheet-tag-suggestions">
              {tagSuggestions.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Notiz</label>
            <textarea
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet resize-none"
            />
          </div>

          {error && <p className="text-sm text-crit">{error}</p>}
        </div>

        <div className="p-6 border-t border-gray-700 bg-[#252525] flex items-center justify-between">
          <button type="button" onClick={removeExemplar} disabled={removing || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-crit hover:bg-crit/10 rounded-lg transition-colors disabled:opacity-50">
            <Trash2 className="w-3.5 h-3.5" /> {removing ? 'Wird entfernt…' : 'Entfernen'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors">Abbrechen</button>
            <button type="button" onClick={save} disabled={saving || removing}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Wird gespeichert…' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
