import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { KIND_LABELS } from '../utils/containerKinds';
import { moveText, selectionText } from '../utils/selection';

const button = 'px-3 py-2 rounded-lg text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

// Mehrfachauswahl (Spec I §5.1, Plan 2026-09-26) -- Leiste unter der Kartenliste, solange ausgewählt wird.
export function SelectionBar({ cards, copies, onSelectAll, onSell, onMove, onCancel }) {
  const none = copies === 0;
  return (
    <div className="shrink-0 mt-3 flex flex-wrap items-center gap-2 bg-surface border border-accent/40 rounded-xl px-4 py-3">
      <span className="text-sm text-text mr-auto">{selectionText(cards, copies)}</span>
      <button type="button" onClick={onSelectAll} className={`${button} bg-surface border-line text-muted hover:text-text`}>Alle sichtbaren</button>
      <button type="button" onClick={onMove} disabled={none} className={`${button} bg-surface border-line text-text hover:border-accent/40 disabled:opacity-50`}>Verschieben…</button>
      <button type="button" onClick={onSell} disabled={none} className={`${button} bg-accent border-accent text-accent-fg disabled:opacity-50`}>Verkaufen…</button>
      <button type="button" onClick={onCancel} className={`${button} bg-surface border-line text-muted hover:text-text`}>Abbrechen</button>
    </div>
  );
}

// Ziel wählen (jeder Behälter oder „Kein Behälter“) und verschieben; Ergebnis mit Rückgängig meldet der Aufrufer.
export function MoveDialog({ copyIds, containers, onClose, onMoved }) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onClose]);
  const live = (containers || []).filter((c) => !c.deleted);
  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const containerId = target === '' ? null : target;
    window.api.relocateCopies({ copyIds, containerId }).then((r) => {
      if (!r?.success) { setError(r?.error || 'Verschieben fehlgeschlagen.'); setBusy(false); return; }
      const name = containerId ? live.find((c) => c.container_id === containerId)?.name ?? null : null;
      onMoved({ moved: r.moved, text: moveText(r.moved.length, name) });
    }).catch((err) => { setError(err?.message || 'Verschieben fehlgeschlagen.'); setBusy(false); });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <form onSubmit={submit} className="bg-surface w-full max-w-md rounded-2xl border border-line shadow-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line flex justify-between items-start gap-3 bg-surface-2">
          <div>
            <h2 className="text-xl font-bold text-text">Verschieben</h2>
            <p className="text-xs text-muted mt-0.5">{copyIds.length === 1 ? '1 Exemplar' : `${copyIds.length} Exemplare`}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Schließen" className="p-2 hover:bg-surface-2 rounded-full text-muted hover:text-text">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-3">
          <label className="block text-xs text-muted">Ziel
            <select autoFocus value={target} onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text">
              <option value="">Kein Behälter (herausnehmen)</option>
              {live.map((c) => <option key={c.container_id} value={c.container_id}>{c.name} ({KIND_LABELS[c.kind] ?? c.kind})</option>)}
            </select>
          </label>
          <p className="text-xs text-muted">Seite und Fach im Ordner werden dabei geleert. Wer schon im Ziel liegt, bleibt, wo er ist.</p>
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
        <div className="px-6 pb-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`${button} bg-surface border-line text-muted hover:text-text`}>Abbrechen</button>
          <button type="submit" disabled={busy} className={`${button} bg-accent border-accent text-accent-fg disabled:opacity-50`}>{busy ? 'Verschiebe…' : 'Verschieben'}</button>
        </div>
      </form>
    </div>
  );
}
