import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { LOADING } from '../utils/deckCoverage';
import {
  AMBIGUOUS, CATALOG_MISSING, OPEN, ambiguousOptionText, countsText, deckNameFor, failedText, importPlan, prepareImport,
  skippedText, suggestionText,
} from '../utils/deckImport';

const SECTIONS = [['main', 'Main Deck'], ['extra', 'Extra Deck'], ['side', 'Side Deck']];

// Katalog aus dem Hauptprozess (catalog-prices.cjs): mit ids nur diese Passcodes, mit null alle Karten kompakt.
const loadCatalog = (ids) => window.api.getCatalogCards(ids);

// Spec E2 §5 — Import-Dialog: Einfuegen (YDKE/Text) und Vorschau. Legt immer ein NEUES Deck an.
// source: { text, name, format } fuer die YDK-Datei (direkt Vorschau) oder {} fuer "Einfügen".
export default function DeckImportDialog({ source, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState(null);
  const [choices, setChoices] = useState({});
  const [name, setName] = useState(deckNameFor(source.name));
  const [error, setError] = useState(null);
  // F7: source.text ist bei einer leeren YDK-Datei "" (falsy) -- die Truthy-Pruefung fiel dann faelschlich in den
  // Einfuegen-Modus statt "Keine Deckliste erkannt" zu zeigen. != null unterscheidet "keine Datei" von "leere Datei".
  const [busy, setBusy] = useState(source.text != null);

  useEffect(() => {
    if (source.text == null) return undefined;
    let alive = true;
    prepareImport(source.text, source.format, loadCatalog)
      .then((r) => { if (!alive) return; setBusy(false); if (r.error) setError(r.error); else setResolved(r.resolved); })
      .catch((e) => { if (alive) { setBusy(false); setError(e.message || String(e)); } });
    return () => { alive = false; };
  }, [source]);

  const plan = useMemo(() => (resolved ? importPlan(resolved, choices) : null), [resolved, choices]);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await prepareImport(text, undefined, loadCatalog);
      if (r.error) setError(r.error);
      else { setChoices({}); setResolved(r.resolved); }
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.createImportedDeck({ name: deckNameFor(name), notes: plan.notes, cards: plan.cards });
      if (res.success) { onCreated(res.deck); return; }
      setError(failedText(res.error));
    } catch (e) {
      setError(failedText(e.message || String(e)));
    }
    setBusy(false);
  };

  const pick = (i, passcode) => setChoices((prev) => {
    const next = { ...prev };
    if (next[i] === passcode) delete next[i];
    else next[i] = passcode;
    return next;
  });

  const openRows = resolved ? resolved.rows.map((row, i) => ({ row, i })).filter(({ row }) => row.status === 'suggest' || row.status === 'ambiguous') : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">{resolved ? 'Import-Vorschau' : 'Einfügen (YDKE/Text)'}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {!resolved && source.text == null && (
          <textarea
            autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={10}
            placeholder="ydke://… oder eine Deckliste, z. B. 3 Ash Blossom & Joyous Spring"
            className="w-full bg-[#1a1a1a] border border-gray-700 text-white px-3 py-2 rounded text-sm font-mono focus:border-space-violet focus:outline-none"
          />
        )}
        {!resolved && busy && <p className="text-sm text-ink-muted">{LOADING}</p>}

        {resolved && plan && (
          <>
            <label className="block text-xs text-ink-muted">
              Deckname
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full bg-[#1a1a1a] border border-gray-700 text-white px-3 py-2 rounded text-sm focus:border-space-violet focus:outline-none" />
            </label>
            {resolved.catalogMissing && <p className="text-sm text-warn">{CATALOG_MISSING}</p>}
            <p className="font-mono text-sm text-ink">
              {countsText(plan.counts)}
              {skippedText(plan.skipped.length) && <span className="text-crit"> · {skippedText(plan.skipped.length)}</span>}
            </p>

            {openRows.length > 0 && (
              <div className="space-y-2">
                {openRows.map(({ row, i }) => (
                  <div key={i} className="p-2 rounded-lg border border-gray-800 bg-black/30">
                    <div className="text-sm text-ink">
                      {row.source}
                      {!row.candidates.some((c) => c.passcode === choices[i]) && <span className="ml-2 text-xs text-warn">{OPEN}</span>}
                    </div>
                    {row.status === 'ambiguous' && <div className="text-xs text-ink-muted">{AMBIGUOUS}</div>}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {row.candidates.map((c) => (
                        <button key={c.passcode} type="button" onClick={() => pick(i, c.passcode)}
                          className={`px-2 py-1 rounded text-xs ${choices[i] === c.passcode ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-300 hover:text-white'}`}>
                          {row.status === 'suggest' ? suggestionText(c.name) : ambiguousOptionText(c)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {SECTIONS.map(([section, title]) => {
              const cards = plan.cards.filter((c) => c.section === section);
              if (cards.length === 0) return null;
              return (
                <div key={section}>
                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">{title}</h4>
                  {cards.map((c) => <div key={c.card_id} className="text-sm text-gray-300 font-mono">{c.count} {c.name}</div>)}
                </div>
              );
            })}

            {plan.skippedLabels.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">Nicht übernommen</h4>
                {plan.skippedLabels.map((line, k) => <div key={k} className="text-sm text-gray-400 font-mono">{line}</div>)}
              </div>
            )}
          </>
        )}

        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Abbrechen</button>
          {resolved ? (
            <button type="button" onClick={create} disabled={busy}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
              {busy ? 'Wird angelegt…' : 'Anlegen'}
            </button>
          ) : !source.text && (
            <button type="button" onClick={preview} disabled={busy || !text.trim()}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
              Vorschau
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
