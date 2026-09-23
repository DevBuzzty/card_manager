import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { LOADING } from '../utils/deckCoverage';
import { missingForWishlist, wishlistConfirmText, wishlistResultText } from '../utils/deckWishlist';

// Spec E1 §6 — Bestaetigung und Rueckmeldung fuer "Fehlende auf die Wunschliste". Die Wunschliste wird beim Oeffnen
// frisch gelesen, damit "stehen schon drauf" stimmt. Anlegen und die EINE Cloud-Suche macht der Hauptprozess.
export default function DeckWishlistDialog({ coverage, cardInfo, onClose }) {
  const [plan, setPlan] = useState(null);
  const [state, setState] = useState({ busy: false, result: null, error: null });

  useEffect(() => {
    let alive = true;
    window.api.getWishlist()
      .then((list) => { if (alive) setPlan(missingForWishlist(coverage, (list || []).map((w) => w.card_id))); })
      .catch((e) => { if (alive) setState((s) => ({ ...s, error: e.message || String(e) })); });
    return () => { alive = false; };
  }, [coverage]);

  const add = async () => {
    setState({ busy: true, result: null, error: null });
    try {
      const items = plan.candidates.map((c) => {
        const info = cardInfo.get(c.card_id) || {};
        return { card_id: c.card_id, name: info.name || c.card_id, image_url: info.image_url || null, max_price: c.max_price };
      });
      const result = await window.api.addMissingToWishlist(items);
      setState({ busy: false, result, error: null });
    } catch (e) {
      setState({ busy: false, result: null, error: e.message || String(e) });
    }
  };

  const text = state.result ? wishlistResultText(state.result) : plan ? wishlistConfirmText(plan) : LOADING;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={state.busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-text">Fehlende auf die Wunschliste</h3>
          <button type="button" onClick={onClose} disabled={state.busy} className="text-muted hover:text-text"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-text">{text}</p>
        {state.error && <p className="text-sm text-bad">{state.error}</p>}
        <div className="flex justify-end gap-2">
          {state.result ? (
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-muted hover:text-text">Schließen</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={state.busy} className="px-3 py-2 text-sm text-muted hover:text-text">Abbrechen</button>
              <button
                type="button" onClick={add} disabled={state.busy || !plan || plan.candidates.length === 0}
                className="px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-fg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {state.busy ? 'Wird hinzugefügt…' : 'Hinzufügen'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
