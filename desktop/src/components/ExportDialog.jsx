import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { EXPORT_FORMAT_OPTIONS, NOTHING_TO_EXPORT, exportScope } from '../utils/exportScope';

// Spec F1 §4 — Export: Format und Umfang wählen, dann Speichern-Dialog im Hauptprozess.
// filterCopyIds: Exemplar-IDs des aktuellen Sammlungsfilters oder null (dann gibt es den Umfang "Aktueller Filter" nicht).
// Spec H1 §5.1: aus "Zum Verkauf" mit initialFormat 'salelist' und filterLabel "Zum Verkauf" (Umfang genau diese Exemplare).
export default function ExportDialog({ onClose, filterCopyIds = null, initialFormat = 'carddex', filterLabel = 'Aktueller Filter' }) {
  const [format, setFormat] = useState(initialFormat);
  const [scopeKind, setScopeKind] = useState(filterCopyIds ? 'filter' : 'all');
  const [containers, setContainers] = useState([]);
  const [containerId, setContainerId] = useState(null);
  const [count, setCount] = useState(null); // null = wird gezählt
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);   // { ok, text }

  useEffect(() => {
    window.api.listContainers().then((list) => {
      setContainers(list || []);
      if (list && list.length) setContainerId(list[0].container_id);
    }).catch(() => setContainers([]));
  }, []);

  const wants = format === 'wantslist';
  const scope = exportScope(scopeKind, { containerId, copyIds: filterCopyIds || [] });

  useEffect(() => {
    let alive = true;
    setCount(null);
    setNote(null);
    window.api.exportCount({ format, scope }).then((res) => {
      if (!alive) return;
      // Bei einem Zähl-Fehler bleibt count null ("…"), statt 0 ("Nichts zu exportieren") vorzutäuschen.
      if (res.error) { setNote({ ok: false, text: res.error }); return; }
      setCount(res.count);
    });
    return () => { alive = false; };
    // scope ist bei jedem Rendern ein neues Objekt; gezählt wird nur, wenn sich seine Teile ändern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, scopeKind, containerId, filterCopyIds]);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await window.api.exportRun({ format, scope });
      if (res.success) setNote({ ok: true, text: res.text });
      else if (res.error) setNote({ ok: false, text: res.error });
    } catch (e) {
      setNote({ ok: false, text: `Export fehlgeschlagen: ${e.message || e}` });
    }
    setBusy(false);
  };

  const scopeOptions = [
    { value: 'all', label: 'Ganze Sammlung' },
    ...(filterCopyIds ? [{ value: 'filter', label: filterLabel }] : []),
    ...(containers.length ? [{ value: 'container', label: 'Ein Behälter' }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-text">Exportieren</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-muted hover:text-text"><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-xs text-muted">Format
          <CustomSelect value={format} onChange={setFormat} options={EXPORT_FORMAT_OPTIONS} className="mt-1 w-full" />
        </label>
        {wants ? (
          <p className="text-sm text-muted">Umfang: Wunschliste</p>
        ) : (
          <>
            <label className="block text-xs text-muted">Umfang
              <CustomSelect value={scopeKind} onChange={setScopeKind} options={scopeOptions} className="mt-1 w-full" />
            </label>
            {scopeKind === 'container' && (
              <label className="block text-xs text-muted">Behälter
                <CustomSelect value={containerId} onChange={setContainerId}
                  options={containers.map((c) => ({ value: c.container_id, label: c.name }))} className="mt-1 w-full" />
              </label>
            )}
          </>
        )}
        <p className="text-sm text-muted">{count == null ? '…' : count === 0 ? NOTHING_TO_EXPORT : `${count} ${wants ? (count === 1 ? 'Wunsch' : 'Wünsche') : (count === 1 ? 'Exemplar' : 'Exemplare')}`}</p>
        {note && <p className={`text-sm ${note.ok ? 'text-good' : 'text-bad'}`}>{note.text}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-muted hover:text-text">Schließen</button>
          <button type="button" onClick={run} disabled={busy || !count}
            className="px-4 py-2 rounded-lg bg-accent hover:brightness-110 text-accent-fg text-sm font-medium disabled:opacity-50">
            {busy ? 'Wird exportiert…' : 'Speichern…'}
          </button>
        </div>
      </div>
    </div>
  );
}
