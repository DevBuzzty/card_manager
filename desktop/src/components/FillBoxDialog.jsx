import { useState } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { EDITION_LABELS } from '../utils/valuation';
import { locationText, shortText, surplusText } from '../utils/fillBoxProposal';

// Spec E1 §7 — Dialog "Box befüllen". Der Vorschlag wird beim Oeffnen eingefroren (proposal): laden die Zahlen nach
// dem Verschieben neu, bleiben die Zeilen mit ihrer Rueckmeldung stehen. Verschoben wird Exemplar fuer Exemplar im
// Hauptprozess (move-copies-to-container); ein Fehlschlag steht an seiner Zeile.
export default function FillBoxDialog({ boxId, boxName, proposal, copiesById, containersById, onClose, onMoved, onOpenWishlist }) {
  const [checked, setChecked] = useState(() => new Set(proposal.rows.map((r) => r.copy_id)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      const copyIds = proposal.rows.filter((r) => checked.has(r.copy_id)).map((r) => r.copy_id);
      const res = await window.api.moveCopiesToContainer({ copyIds, containerId: boxId });
      if (res.success) {
        setResults(new Map(res.results.map((r) => [r.copy_id, r])));
        onMoved();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  const short = shortText(proposal.short);
  const surplus = surplusText(proposal.surplus);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Box befüllen · {boxName}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {proposal.rows.length === 0 && <p className="text-sm text-ink-muted">Nichts zu verschieben.</p>}
          {proposal.rows.map((r) => {
            const cp = copiesById.get(r.copy_id);
            const result = results && results.get(r.copy_id);
            return (
              <label key={r.copy_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-obsidian-600 text-sm">
                <input type="checkbox" checked={checked.has(r.copy_id)} disabled={busy || !!results} onChange={() => toggle(r.copy_id)} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-ink">{cp.card_name || cp.card_id}</span>
                  <span className="block truncate font-mono text-xs text-ink-muted">
                    {cp.set_code} · {cp.rarity} · {EDITION_LABELS[cp.edition] || cp.edition}
                  </span>
                </span>
                <span className="text-xs text-ink-muted">{locationText(cp, containersById.get(cp.container_id))}</span>
                {result && result.success && <Check className="w-4 h-4 text-good" />}
                {result && !result.success && <span className="text-xs text-crit">{result.error}</span>}
              </label>
            );
          })}
        </div>

        {short && (
          <p className="text-sm text-warn flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {short} ·{' '}
            <button type="button" onClick={onOpenWishlist} className="text-space-violet hover:underline">Fehlende auf die Wunschliste</button>
          </p>
        )}
        {surplus && <p className="text-sm text-ink-muted">{surplus}</p>}
        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Schließen</button>
          {!results && (
            <button
              type="button" onClick={move} disabled={busy || checked.size === 0}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Wird verschoben…' : 'In die Box verschieben'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
