import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown, X, PackageOpen, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import CustomSelect from './CustomSelect';
import { fmtEUR } from '../utils/format';
import { binderRoute, cardRoute } from '../utils/routes';
import { KIND_LABELS, KIND_OPTIONS } from '../utils/containerKinds';
import { COLOR_PRESETS, DEFAULT_COLOR } from '../utils/containerColors';

const POCKET_OPTIONS = [4, 9, 12].map(p => ({ value: String(p), label: `${p} Fächer pro Seite` }));
// Freie Etiketten-Farben fuer Behaelter: utils/containerColors.js (Zwilling mit dem Handy, Abschlussreview B10).
const emptyForm = { container_id: null, name: '', kind: 'binder', pockets_per_page: '4', color: DEFAULT_COLOR };

// Spec B1 §7.1: Behälter (Ordner/Box/Deckbox) mit Belegung, Anlegen/Umbenennen/Löschen und dem
// Zähler für Exemplare ohne Behälter. window.api ist im reinen Browser-Modus (`npm run dev`)
// nicht vorhanden -- jeder Aufruf greift defensiv darauf zu, damit die Seite dort bedienbar bleibt.
export default function Binders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [containers, setContainers] = useState([]);
  const [unsorted, setUnsorted] = useState([]);
  const [showUnsorted, setShowUnsorted] = useState(false);
  const [dialog, setDialog] = useState(null); // { form, error, saving } | null
  const [menu, setMenu] = useState(null); // { x, y, container } | null
  const [error, setError] = useState(null); // Lade- oder Umsortierfehler -- eine Anzeigestelle fuer beide
  const menuRef = useRef(null);
  const savingRef = useRef(false); // Sperrt submitDialog gegen Doppelaufruf, gleiche Bauart wie StagingArea.jsx's committingRef

  // Gibt zurueck, ob das Laden geklappt hat, damit ein Aufrufer wie move() seine eigene
  // Fehlermeldung nur setzen darf, wenn load() hier nicht schon eine eigene (schwerwiegendere,
  // weil die Ansicht dann nichts Verlaessliches mehr zeigt) gesetzt hat.
  const load = async () => {
    try {
      const [c, u] = await Promise.all([
        window.api?.listContainers?.() ?? [],
        window.api?.listUnsortedCopies?.() ?? [],
      ]);
      // list-containers/list-unsorted-copies werfen bei einem DB-Fehler (main.cjs) und liefern
      // deshalb regulaer nie {success:false} -- wird trotzdem defensiv erkannt, falls sich das aendert.
      if (c?.success === false) throw new Error(c.error || 'Laden fehlgeschlagen.');
      if (u?.success === false) throw new Error(u.error || 'Laden fehlgeschlagen.');
      setContainers(c || []);
      setUnsorted(u || []);
      setError(null);
      return true;
    } catch (e) {
      setError(e?.message || 'Laden fehlgeschlagen.');
      return false;
    }
  };

  // Deferred one tick, same as Wishlist.jsx's initial load -- a setState call made
  // synchronously from within the effect body trips react-hooks/set-state-in-effect.
  useEffect(() => { setTimeout(() => load(), 0); }, []);

  // Any left click elsewhere closes the context menu; clicks inside it stop the event first.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  // Clamps the menu into the viewport after it renders (its real size isn't known before that) --
  // without this a right-click near the right/bottom edge pushes it partly off-screen.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const x = Math.min(menu.x, maxX);
    const y = Math.min(menu.y, maxY);
    if (x !== menu.x || y !== menu.y) setMenu(m => (m ? { ...m, x, y } : m));
  }, [menu]);

  const openCreate = () => { setDialog({ form: { ...emptyForm }, error: null, saving: false }); setMenu(null); };
  const openEdit = (c) => {
    setDialog({
      form: {
        container_id: c.container_id,
        name: c.name,
        kind: c.kind,
        pockets_per_page: c.pockets_per_page ? String(c.pockets_per_page) : '4',
        color: c.color || DEFAULT_COLOR,
      },
      error: null,
      saving: false,
    });
    setMenu(null);
  };
  const closeDialog = () => setDialog(null);

  const setForm = (patch) => setDialog(d => ({ ...d, form: { ...d.form, ...patch } }));

  const submitDialog = async (e) => {
    e.preventDefault();
    // Sperrt einen Doppelklick oder zweimal Enter, bevor saveContainer zurueckkommt -- sonst ist
    // form.container_id beim zweiten Aufruf immer noch null und crypto.randomUUID() legt einen
    // zweiten Behaelter an. Der Ref wirkt synchron (anders als ein State), daher gleiche Bauart
    // wie StagingArea.jsx's committingRef.
    if (!dialog || savingRef.current) return;
    savingRef.current = true;
    setDialog(d => (d ? { ...d, saving: true } : d));
    try {
      const { form } = dialog;
      const existing = form.container_id ? containers.find(c => c.container_id === form.container_id) : null;
      const payload = {
        container_id: form.container_id || crypto.randomUUID(),
        name: form.name,
        kind: form.kind,
        pockets_per_page: form.kind === 'binder' ? Number(form.pockets_per_page) : undefined,
        color: form.color,
        sort_order: existing ? existing.sort_order : containers.length,
      };
      const result = await window.api?.saveContainer?.(payload);
      if (!result?.success) {
        setDialog(d => (d ? { ...d, error: result?.error || 'Speichern fehlgeschlagen.', saving: false } : d));
        return;
      }
      setDialog(null);
      load();
    } finally {
      savingRef.current = false;
    }
  };

  const removeContainer = async (c) => {
    setMenu(null);
    const n = c.copies_count || 0;
    const notice = `${n} ${n === 1 ? 'Exemplar wird' : 'Exemplare werden'} auf „nicht einsortiert“ gesetzt.`;
    if (!confirm(`„${c.name}“ löschen? ${notice}`)) return;
    const result = await window.api?.deleteContainer?.(c.container_id);
    if (!result?.success) { alert(result?.error || 'Löschen fehlgeschlagen.'); return; }
    load();
  };

  // Swaps two neighbors in display order, then renumbers everyone's sort_order to their new
  // index -- robust even when several containers still share the same default sort_order.
  const move = async (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= containers.length) return;
    const next = [...containers];
    [next[index], next[j]] = [next[j], next[index]];
    const results = await Promise.all(next.map((c, i) => window.api?.saveContainer?.({
      container_id: c.container_id,
      name: c.name,
      kind: c.kind,
      pockets_per_page: c.kind === 'binder' ? c.pockets_per_page : undefined,
      color: c.color,
      sort_order: i,
    })));
    // load() setzt error selbst (auf null bei Erfolg) -- erst danach ueberschreiben, sonst wischt
    // der Erfolgsfall des Neuladens die hier erkannte Umsortier-Fehlermeldung sofort wieder weg.
    // Schlaegt load() dabei selbst fehl, hat es bereits seine eigene (schwerwiegendere) Meldung
    // gesetzt -- die darf hier nicht ueberschrieben werden, sonst erfaehrt der Nutzer nichts vom
    // Ladefehler und die Ansicht zeigt weiterhin nichts Verlaessliches.
    const loaded = await load();
    if (loaded && results.some(r => r && r.success === false)) {
      setError('Umsortieren fehlgeschlagen — die Reihenfolge wurde nicht vollständig gespeichert.');
    }
  };

  const openCard = (copy) => {
    navigate(
      cardRoute({ id: copy.card_id, set_code: copy.set_code, language: copy.language, rarity: copy.rarity }),
      { state: { background: location } }
    );
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowUnsorted(o => !o)}
        className={clsx(
          'flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors shrink-0',
          showUnsorted ? 'bg-accent/15 border-accent/40 text-text' : 'bg-surface border-line text-muted hover:text-text'
        )}
      >
        <span className="font-display font-medium">
          Nicht einsortiert: {unsorted.length} {unsorted.length === 1 ? 'Exemplar' : 'Exemplare'}
        </span>
        {showUnsorted ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showUnsorted && (
        <div className="bg-surface border border-line rounded-xl p-2 shrink-0 max-h-64 overflow-y-auto custom-scrollbar">
          {unsorted.length === 0 ? (
            <p className="text-sm text-muted px-2 py-1">Alle Exemplare sind einsortiert.</p>
          ) : (
            <div className="space-y-1">
              {unsorted.map(copy => (
                <button
                  key={copy.copy_id}
                  type="button"
                  onClick={() => openCard(copy)}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bg text-left transition-colors"
                >
                  <div className="w-8 h-11 bg-bg rounded overflow-hidden shrink-0">
                    {copy.card_image_url && <img src={copy.card_image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <span className="flex-1 truncate text-sm text-text">{copy.card_name}</span>
                  <span className="text-xs text-muted font-mono shrink-0">{copy.set_code} · {copy.rarity}</span>
                  <span className="text-xs text-muted font-mono shrink-0">{fmtEUR(copy.card_price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between shrink-0">
        <h2 className="font-display text-lg text-text">Behälter</h2>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent hover:brightness-110 text-accent-fg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Neuer Behälter
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {containers.length === 0 && !error ? (
          <div className="h-full flex flex-col items-center justify-center text-muted">
            <PackageOpen className="w-16 h-16 mb-4 opacity-40" />
            <p>Noch keine Behälter angelegt.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {containers.map((c, i) => (
              <div
                key={c.container_id}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, container: c }); }}
                // Spec B2 §7.2: die Karte ist der Einstieg in den aufgeschlagenen Behälter. Die
                // beiden Pfeilknöpfe darin halten das Klickereignis auf (siehe unten), sonst
                // öffnete jedes Umsortieren zusätzlich die Ansicht.
                onClick={() => navigate(binderRoute(c.container_id))}
                title={`„${c.name}“ öffnen`}
                className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2 hover:border-accent/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color || '#6b6383' }} />
                    <span className="font-display font-medium text-text truncate">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); move(i, -1); }} disabled={i === 0}
                            title="Nach oben" className="p-1 text-muted hover:text-text disabled:opacity-30 disabled:cursor-default">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); move(i, 1); }} disabled={i === containers.length - 1}
                            title="Nach unten" className="p-1 text-muted hover:text-text disabled:opacity-30 disabled:cursor-default">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <span className="text-xs text-muted">{KIND_LABELS[c.kind] || c.kind}</span>
                <span className="text-sm text-muted">
                  {c.copies_count} {c.copies_count === 1 ? 'Exemplar' : 'Exemplare'}
                  {/* Spec 5.3: die hoechste BELEGTE Seite bestimmt die Anzeige, nie ceil(Anzahl/Faecher).
                      Dieselbe Zahl, die der aufgeschlagene Ordner als "von N" zeigt: copies.cjs#listContainers
                      rechnet max_page ueber dieselbe Fachpruefung wie binderGrid.js#isPlaced, und die 1 bei
                      NULL ist binderGrid.js#pageCounts Mindestwert -- ein leerer Ordner hat eine leere erste
                      Seite zum Blaettern. */}
                  {c.kind === 'binder' && c.pockets_per_page
                    ? ` · ${c.max_page ?? 1} ${(c.max_page ?? 1) === 1 ? 'Seite' : 'Seiten'}`
                    : ''}
                </span>
                <span className="text-sm font-mono text-accent">{fmtEUR(c.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          className="z-[100] bg-bg border border-line rounded-xl shadow-sm p-1 min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => openEdit(menu.container)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text hover:bg-surface text-left">
            <Pencil className="w-3.5 h-3.5" /> Umbenennen
          </button>
          <button type="button" onClick={() => removeContainer(menu.container)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-bad hover:bg-bad/10 text-left">
            <Trash2 className="w-3.5 h-3.5" /> Löschen
          </button>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm" onClick={closeDialog}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitDialog}
                className="w-full max-w-md bg-surface border border-line rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-text">{dialog.form.container_id ? 'Behälter bearbeiten' : 'Neuer Behälter'}</h3>
              <button type="button" onClick={closeDialog} className="text-muted hover:text-text"><X className="w-4 h-4" /></button>
            </div>

            <div>
              <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Name</label>
              <input
                autoFocus
                type="text"
                value={dialog.form.name}
                onChange={(e) => setForm({ name: e.target.value })}
                className="w-full bg-bg border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Art</label>
              <CustomSelect value={dialog.form.kind} onChange={(v) => setForm({ kind: v })} options={KIND_OPTIONS} />
            </div>

            {dialog.form.kind === 'binder' && (
              <div>
                <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Fächer pro Seite</label>
                <CustomSelect value={dialog.form.pockets_per_page} onChange={(v) => setForm({ pockets_per_page: v })} options={POCKET_OPTIONS} />
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-muted mb-1 uppercase tracking-wider">Farbe</label>
              <div className="flex gap-2">
                {COLOR_PRESETS.map(hex => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setForm({ color: hex })}
                    className={clsx('w-7 h-7 rounded-full border-2 transition-transform', dialog.form.color === hex ? 'border-text scale-110' : 'border-transparent')}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>

            {dialog.error && <p className="text-sm text-bad">{dialog.error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={closeDialog} className="px-3 py-2 text-sm text-muted hover:text-text">Abbrechen</button>
              <button type="submit" disabled={dialog.saving}
                      className="px-4 py-2 rounded-lg bg-accent hover:brightness-110 text-accent-fg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {dialog.saving ? 'Wird gespeichert…' : 'Speichern'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
