import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Minus, PackageOpen, Trash2, Loader2, X } from 'lucide-react';
import SealedAddDialog from './SealedAddDialog';
import { fmtEUR } from '../utils/format';
import { ROUTES } from '../utils/routes';

const LOAD_ERROR = 'Sealed-Bestand konnte nicht geladen werden.';
const WRITE_ERROR = 'Speichern fehlgeschlagen.';

// Spec G3 §7.3 — Sammlung › Sealed. Reihenfolge, Summen, „Preis veraltet“ und Art-Bezeichnung kommen fertig aus
// dem Hauptprozess (sealed-list, Regeln in electron/sealed-value.cjs); hier wird nur angezeigt und geschrieben.
export default function SealedList() {
  const [state, setState] = useState(() => (window.api?.listSealed
    ? { loading: true, error: null, data: null }
    : { loading: false, error: LOAD_ERROR, data: null }));
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState(null); // { sealed_id, name, deleted } der zuletzt geöffneten Zeile
  const [writeError, setWriteError] = useState(null);
  // Fix round 1: Zeilen, deren Schreibvorgang (IPC-Aufruf + anschliessendes Neuladen) noch laeuft --
  // solange gesperrt, damit ein zweiter Klick nicht auf einer veralteten Menge aufsetzt (Doppel-Oeffnen,
  // verlorenes Inkrement bei schnellem Doppelklick).
  const [busyIds, setBusyIds] = useState(() => new Set());
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Gemeinsam fuer den ersten Ladevorgang, das sealed-changed-Ereignis (Sync, Bulk-Schritt C) und
  // jeden Schreibvorgang unten -- ein Schreibvorgang gilt erst als fertig, wenn diese Liste die
  // frische Menge zeigt (siehe write()).
  const load = () => (window.api?.listSealed
    ? window.api.listSealed()
        .then((data) => { if (aliveRef.current) setState({ loading: false, error: null, data }); })
        .catch(() => { if (aliveRef.current) setState((s) => ({ loading: false, error: LOAD_ERROR, data: s.data })); })
    : Promise.resolve());

  useEffect(() => {
    if (!window.api?.listSealed) return undefined;
    load();
    const off = window.api.onSealedChanged?.(() => load());
    return off;
  }, []);

  const isBusy = (id) => busyIds.has(id);
  const setRowBusy = (id, val) => setBusyIds((prev) => {
    const next = new Set(prev);
    if (val) next.add(id); else next.delete(id);
    return next;
  });

  // Busy bleibt bis NACH dem anschliessenden Neuladen gesetzt (nicht schon nach der IPC-Antwort) --
  // erst dann zeigt die Zeile wieder eine Menge, auf der ein weiterer Klick sicher aufsetzen kann.
  const write = (item, promise, afterSuccess) => {
    setRowBusy(item.sealed_id, true);
    promise
      .then((r) => {
        if (r && r.success === false) { setWriteError(r.error || WRITE_ERROR); return; }
        setWriteError(null);
        afterSuccess?.(r);
      })
      .catch(() => setWriteError(WRITE_ERROR))
      .finally(() => load().finally(() => setRowBusy(item.sealed_id, false)));
  };

  const setQuantity = (item, quantity) => write(item, window.api.setSealedQuantity({ sealed_id: item.sealed_id, quantity }));
  const remove = (item) => {
    if (isBusy(item.sealed_id)) return;
    if (!confirm(`„${item.name}“ löschen?`)) return;
    setOpened(null);
    write(item, window.api.deleteSealed(item.sealed_id));
  };
  // Spec G3 §4.1: Menge − bis 1; bei 1 nach Rückfrage Soft-Delete. `item` kommt aus der aktuell
  // gerenderten Zeile (data.items.map unten), nie aus einer eingefrorenen alten Fassung.
  const minus = (item) => {
    if (isBusy(item.sealed_id)) return;
    setOpened(null);
    if (item.quantity > 1) setQuantity(item, item.quantity - 1);
    else remove(item);
  };
  const plus = (item) => {
    if (isBusy(item.sealed_id)) return;
    setOpened(null);
    setQuantity(item, item.quantity + 1);
  };
  const open = (item) => {
    if (isBusy(item.sealed_id)) return;
    if (item.quantity === 1 && !confirm(`Letztes Exemplar von „${item.name}“ geöffnet? Der Eintrag wird entfernt.`)) return;
    setOpened(null);
    write(item, window.api.openSealed(item.sealed_id),
      (r) => setOpened({ sealed_id: item.sealed_id, name: item.name, deleted: !!r?.deleted }));
  };

  const data = state.data;
  // Fix round 1: der Hinweis haengt nicht unbegrenzt -- ein eigener Schliessen-Knopf, und jede
  // andere Zeilen-Aktion (−/+/Geöffnet/Löschen) oder ein erfolgreiches Hinzufügen räumt ihn weg.
  const scanHint = (
    <span className="inline-flex items-center gap-1 text-xs text-good">
      Geöffnet — <Link to={ROUTES.scannen} className="underline hover:text-ink">Jetzt scannen</Link>
      <button type="button" onClick={() => setOpened(null)} aria-label="Hinweis schließen" className="text-ink-faint hover:text-ink">
        <X className="w-3 h-3" />
      </button>
    </span>
  );

  return (
    <div className="h-full overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="font-display text-[11px] tracking-[0.14em] uppercase text-ink-muted">Sealed-Wert</div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{data ? fmtEUR(data.sealedValue) : '—'}</div>
        </div>
        <button type="button" onClick={() => setAdding(true)}
                className="flex items-center gap-2 bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Hinzufügen
        </button>
      </div>

      {writeError && <p className="text-sm text-crit mb-3">{writeError}</p>}
      {state.error && <p className="text-sm text-crit mb-3">{state.error}</p>}
      {/* Die Zeile ist nach dem Öffnen des letzten Exemplars weg — der Hinweis steht dann hier. */}
      {opened?.deleted && <p className="text-sm text-ink mb-3">„{opened.name}“ · {scanHint}</p>}

      {!data && state.loading && (
        <div className="flex items-center justify-center gap-2 text-ink-muted py-10">
          <Loader2 className="w-5 h-5 animate-spin" /> Sealed-Bestand wird geladen …
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="text-center text-ink-faint py-10">Noch kein Sealed-Bestand</div>
      )}
      {data && data.items.length > 0 && (
        <div className="bg-obsidian-700 border border-line rounded-2xl divide-y divide-line">
          {data.items.map((item) => {
            const rowBusy = isBusy(item.sealed_id);
            return (
              <div key={item.sealed_id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">{item.kindLabel}</div>
                  <div className="text-sm text-ink truncate">{item.name}</div>
                  {opened && !opened.deleted && opened.sealed_id === item.sealed_id && scanHint}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => minus(item)} disabled={rowBusy} title="Menge verringern"
                          className="p-1.5 rounded-lg border border-line text-ink-muted hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-8 text-center font-mono text-sm text-ink">{item.quantity}</span>
                  <button type="button" onClick={() => plus(item)} disabled={rowBusy} title="Menge erhöhen"
                          className="p-1.5 rounded-lg border border-line text-ink-muted hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"><Plus className="w-3.5 h-3.5" /></button>
                </div>
                <div className="w-28 text-right">
                  <div className="font-mono text-xs text-ink-muted">je {item.price == null ? '—' : fmtEUR(item.price)}</div>
                  {item.stale && <div className="text-[11px] text-gold">Preis veraltet</div>}
                </div>
                <div className="w-28 text-right font-mono text-sm text-ink">{item.lineValue == null ? '—' : fmtEUR(item.lineValue)}</div>
                <button type="button" onClick={() => open(item)} disabled={rowBusy}
                        className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink border border-line rounded-lg px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed">
                  <PackageOpen className="w-3.5 h-3.5" /> Geöffnet
                </button>
                <button type="button" onClick={() => remove(item)} disabled={rowBusy} title="Löschen"
                        className="p-1.5 rounded-lg text-crit hover:bg-crit/10 disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <SealedAddDialog
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); setOpened(null); load(); }}
        />
      )}
    </div>
  );
}
