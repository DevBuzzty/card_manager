import { useMemo, useRef, useState } from 'react';
import {
  LOADING, duplicatesSummary, headerText, confirmAllText, rowCountText, proposalTexts,
  toggleIsOn, premarkedIds, toggleTargets, allProposalIds,
} from '../utils/duplicates';
import { createBusyGate } from '../utils/busyGate';

// Spec H1 §5.1 -- Sammlung › Karten › Duplikate. list: Ergebnis von duplicates() (null = laedt), copies: Zeilen aus
// list-sale-copies, reload(): Promise, onOpenCard(copy): Karten-Detail. Jede Schreibaktion laeuft durch das
// Busy-Gatter (frueher Return, Schalter und Knopf gesperrt) und gibt erst nach dem frischen Stand frei.
export default function DuplicatesList({ list, copies, reload, onOpenCard }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // §5.4: je Haupt-Passcode die Vorschlaege, die beim Einschalten in dieser Ansicht schon markiert waren.
  const history = useRef(new Map());

  const byId = useMemo(() => new Map((copies || []).map((c) => [c.copy_id, c])), [copies]);
  const forSaleIds = useMemo(() => new Set((copies || []).filter((c) => c.for_sale).map((c) => c.copy_id)), [copies]);
  const summary = useMemo(() => (list ? duplicatesSummary(list) : null), [list]);

  // -> true, wenn geschrieben wurde (oder nichts zu schreiben war).
  const write = async (ids, value) => {
    if (ids.length === 0) return true;
    const res = await window.api.setForSale({ copyIds: ids, value });
    if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return false; }
    return true;
  };

  const run = (action) => gate.run(async () => {
    setBusy(true);
    setError(null);
    try {
      if (await action()) await reload();
    } catch (e) {
      setError(e?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  });

  const toggle = (entry) => run(() => {
    const on = !toggleIsOn(entry, forSaleIds);
    if (on) history.current.set(entry.main_id, premarkedIds(entry, forSaleIds));
    const t = toggleTargets(entry, on, on ? null : (history.current.get(entry.main_id) ?? null));
    if (!on) history.current.delete(entry.main_id);
    return write(t.ids, t.value);
  });

  const markAll = () => {
    if (gate.running || !summary) return;
    if (!confirm(confirmAllText(summary))) return;
    run(() => write(allProposalIds(list, forSaleIds), true));
  };

  if (!list) return <div className="h-full flex items-center justify-center text-muted">{LOADING}</div>;

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 bg-surface border border-line rounded-xl px-4 py-3 shrink-0">
        <span className="text-sm text-text flex-1">{headerText(summary)}</span>
        <button type="button" onClick={markAll} disabled={busy || list.length === 0}
          className="px-3 py-1.5 bg-accent hover:bg-accent/90 text-accent-fg rounded-lg text-xs font-medium disabled:opacity-50">
          Alle Vorschläge auf die Verkaufsliste
        </button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {list.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">Keine Duplikate.</div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {list.map((entry) => {
            const first = byId.get(entry.copy_ids[0]) || {};
            const on = toggleIsOn(entry, forSaleIds);
            return (
              <div key={entry.main_id} onClick={() => onOpenCard(first)}
                className="flex items-center gap-3 bg-surface hover:bg-surface-2 border border-line rounded-xl p-3 cursor-pointer">
                <div className="w-12 h-16 rounded overflow-hidden bg-bg shrink-0">
                  {first.image_url && <img src={first.image_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-text truncate">{first.name || entry.main_id}</div>
                  <div className="text-xs text-muted">{rowCountText(entry)}</div>
                  {proposalTexts(entry, byId).map((t) => <div key={t} className="text-[11px] font-mono text-muted truncate">{t}</div>)}
                </div>
                <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 text-xs text-muted shrink-0 cursor-pointer select-none">
                  <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={() => toggle(entry)} className="accent-accent" />
                  Auf die Verkaufsliste
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
