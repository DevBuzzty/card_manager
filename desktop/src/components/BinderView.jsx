import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Inbox, PackageOpen, X } from 'lucide-react';
import clsx from 'clsx';
import CopySheet from './CopySheet';
import { fmtEUR } from '../utils/format';
import { ROUTES, cardRoute } from '../utils/routes';
import { formatCopyLocation } from '../utils/copyLocation';
import { EDITION_LABELS, conditionFactor, unitPrice } from '../utils/valuation';
import { candidateGroups, candidatesEmpty, columns, loose, pageCount, slots } from '../utils/binderGrid';
import { copyKey, printingKey } from '../utils/printingKey';
import { KIND_LABELS } from '../utils/containerKinds';

/**
 * Spec B2 §7.2, Desktop-Haelfte: EIN Behaelter, aufgeschlagen. Ordner zeigen zwei Fachraster
 * nebeneinander (Doppelseite) und blaettern per Pfeilknopf oder Tastatur; Box und Deckbox haben
 * keine Seiten und zeigen stattdessen eine Liste mit Standort-Chip.
 *
 * KEIN „Einsortieren"-Knopf: der Modus ist ausdruecklich Handy-only (Spec §3, Nicht-Ziele). Die
 * Bedienung ist die des Schreibtischs -- Rechtsklick statt Langdruck, Pfeile und Tastatur statt
 * Wischen.
 *
 * Keine Regel wird hier selbst getroffen:
 * - Rasterform, Seitenzahl und die Zuordnung Exemplar -> Fach kommen aus ../utils/binderGrid.js
 *   (geprueft in binderGrid.test.js), dem Zwilling von BinderGrid.kt.
 * - Ob Seite und Fach ueberhaupt geschrieben werden, entscheidet electron/copies.cjs
 *   #setCopyLocation anhand der Behaelterart in der Datenbank -- page/slot gehen deshalb ROH mit,
 *   ohne ein `if (isBinder)` davor (dieselbe Ueberlegung wie in CopySheet.jsx).
 * - Der Standort-Text kommt aus ../utils/copyLocation.js, der Zustandsfaktor aus
 *   ../utils/valuation.js.
 *
 * Der Kotlin-Gegenpart dieser ANSICHT ist ui/BinderPageScreen.kt. Gemeinsam ist beiden nur, was in
 * binderGrid.js/BinderGrid.kt steht -- die Bedienung ist absichtlich verschieden.
 */
export default function BinderView({ panelOpen = false }) {
  const { containerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [containers, setContainers] = useState([]);
  const [allCopies, setAllCopies] = useState([]);
  const [unsorted, setUnsorted] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  // Ein Ladefehler darf nicht wie ein leerer Ordner aussehen: eigener Zustand, im Erfolgsfall
  // ausdruecklich auf null zurueckgesetzt, und jede Leermeldung haengt zusaetzlich an
  // `!error`. Das Banner steht ganz oben im Aufbau und in KEINEM zuklappbaren Bereich -- in B1
  // ist genau das zweimal hintereinander schiefgegangen. Gleiche Bauart wie Binders.jsx.
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Sperrt einen zweiten Klick, bevor der erste Schreibvorgang zurueck ist. Der Ref wirkt synchron
  // (React-State erst nach der naechsten Zeichnung), gleiche Bauart wie Binders.jsx's savingRef.
  const savingRef = useRef(false);

  const [left, setLeft] = useState(1);                 // linke Seite der offenen Doppelseite, immer ungerade
  const [menu, setMenu] = useState(null);              // Rechtsklick auf ein belegtes Fach: { x, y, page, slot }
  const [fill, setFill] = useState(null);              // Klick auf ein leeres Fach: { page, slot }
  const [query, setQuery] = useState('');              // Suche im Auswahlangebot
  const [sheetCopy, setSheetCopy] = useState(null);    // „Verschieben nach…" -> CopySheet
  const menuRef = useRef(null);

  // Gibt zurueck, ob das Laden geklappt hat -- wie Binders.jsx#load, damit ein Aufrufer seine
  // eigene Meldung nicht ueber die schwerwiegendere Lademeldung schreibt.
  const load = async () => {
    try {
      const [cs, cp, un, cd] = await Promise.all([
        window.api?.listContainers?.() ?? [],
        window.api?.listAllCopies?.() ?? [],
        window.api?.listUnsortedCopies?.() ?? [],
        window.api?.getCollection?.() ?? [],
      ]);
      setContainers(Array.isArray(cs) ? cs : []);
      setAllCopies(Array.isArray(cp) ? cp : []);
      setUnsorted(Array.isArray(un) ? un : []);
      setCards(Array.isArray(cd) ? cd : []);
      setError(null);
      return true;
    } catch (e) {
      setError(e?.message || 'Laden fehlgeschlagen.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Um eine Runde verzoegert, wie Binders.jsx: ein setState direkt im Effektkoerper stolpert ueber
  // react-hooks/set-state-in-effect.
  // setLeft(1) mit dabei: ein anderer Behaelter faengt vorn an, statt auf der Doppelseite des
  // vorigen aufzuschlagen (die Ansicht wird beim Wechsel der Route nicht neu aufgebaut).
  useEffect(() => { setTimeout(() => { setLeft(1); load(); }, 0); }, [containerId]);

  const container = containers.find(c => c.container_id === containerId);
  const isBinder = container?.kind === 'binder';
  const pockets = container?.pockets_per_page ?? 0;   // 0 -> clampPockets zieht auf 4
  const myCopies = useMemo(
    () => allCopies.filter(c => c.container_id === containerId),
    [allCopies, containerId],
  );
  // Exemplare dieses Behaelters ohne darstellbares Fach: sie stehen unter der Doppelseite UND ganz
  // oben im Auswahlangebot fuer ein leeres Fach.
  const looseCopies = useMemo(() => loose(myCopies, pockets), [myCopies, pockets]);
  // ABGELEITET, nicht zweiter Zustand: dieselbe Liste und dieselbe Fachzahl, aus denen auch die
  // Raster gebaut werden. Ein eigenes, in load() gesetztes Feld waere eine zweite Filterung --
  // heute deckungsgleich, morgen still auseinandergelaufen.
  const pages = useMemo(() => pageCount(myCopies, pockets), [myCopies, pockets]);
  const cols = columns(pockets);

  const cardsByKey = useMemo(() => {
    const m = new Map();
    for (const c of cards) m.set(printingKey(c), c);
    return m;
  }, [cards]);
  // listUnsortedCopies bringt card_name schon mit; fuer alles andere kommt der Name aus der
  // Sammlung, weil er an der Druckvariante haengt und nicht am Exemplar.
  const nameOf = (cp) => cardsByKey.get(copyKey(cp))?.name ?? cp.card_name ?? null;
  const imageOf = (cp) => cardsByKey.get(copyKey(cp))?.image_url ?? cp.card_image_url ?? null;
  // Spec G4 §6: unitPrice nimmt fuer edition = 'first' den 1st-Ed-Preis der Druckvariante.
  const valueOf = (list) => list.reduce(
    (sum, cp) => sum + unitPrice(cardsByKey.get(copyKey(cp)), cp) * conditionFactor(cp.condition),
    0,
  );

  // Eine Doppelseite beginnt immer auf einer ungeraden Seite -- sonst waenderte ein Exemplar beim
  // Blaettern zwischen linker und rechter Haelfte, je nachdem, woher man kommt.
  const lastLeft = pages % 2 === 0 ? pages - 1 : pages;
  const leftPage = Math.min(Math.max(1, left), Math.max(1, lastLeft));
  const rightPage = leftPage + 1 <= pages ? leftPage + 1 : null;
  const flip = (delta) => setLeft(Math.min(Math.max(1, lastLeft), Math.max(1, leftPage + delta)));

  const leftSlots = useMemo(() => slots(myCopies, leftPage, pockets), [myCopies, leftPage, pockets]);
  const rightSlots = useMemo(
    () => (rightPage ? slots(myCopies, rightPage, pockets) : null),
    [myCopies, rightPage, pockets],
  );
  const openValue = valueOf([...leftSlots.flat(), ...(rightSlots ? rightSlots.flat() : [])]);

  // panelOpen kommt von App.jsx: steht die Kartendetail-Ansicht offen, blaettert der Ordner
  // NICHT mehr mit. Der Wert MUSS von dort kommen -- ein Vergleich mit useLocation() ginge hier
  // ins Leere, weil <Routes location={background}> seinen Nachfahren bereits die
  // HINTERGRUND-Location liefert, also genau die des Ordners. App.jsx steht ausserhalb dieses
  // Routes und sieht als einzige die echte Adresse (gleiche Bauart wie das paletteOpen, das es an
  // CardDetailPanel reicht).
  const overlayOpen = !!(menu || fill || sheetCopy || panelOpen);

  // ← und → blaettern. Alt+Pfeil gehoert dem Verlauf (App.jsx), ein offenes Fenster und jedes
  // Eingabefeld bekommen die Taste zuerst.
  useEffect(() => {
    if (!isBinder || overlayOpen) return;
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      flip(e.key === 'ArrowLeft' ? -2 : 2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isBinder, overlayOpen, leftPage, lastLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jeder Linksklick woanders schliesst das Kontextmenue; Klicks darin halten das Ereignis auf.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  // Klemmt das Menue nach dem Zeichnen ins Fenster (vorher ist seine Groesse unbekannt) --
  // uebernommen aus Binders.jsx, damit ein Rechtsklick am Rand nicht halb hinausragt.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    const x = Math.min(menu.x, maxX);
    const y = Math.min(menu.y, maxY);
    if (x !== menu.x || y !== menu.y) setMenu(m => (m ? { ...m, x, y } : m));
  }, [menu]);

  const openCard = (cp) => {
    navigate(
      cardRoute({ id: cp.card_id, set_code: cp.set_code, language: cp.language, rarity: cp.rarity }),
      { state: { background: location } },
    );
  };

  // Ein Schreibweg fuer beide Aktionen dieser Seite (aus dem Fach nehmen, in ein Fach legen):
  // Sperre, Schreiben, Neuladen. Liefert false, wenn die Sperre den Vorgang verworfen hat -- der
  // Aufrufer schliesst sein Fenster dann nicht. Bei einem abgelehnten Schreibvorgang wird NICHT
  // neu geladen: load() setzt error im Erfolgsfall auf null und wischte die Meldung sofort weg.
  // Binders.jsx#move loest dieselbe Klemme andersherum -- es laedt zuerst neu und setzt seine
  // eigene Meldung erst danach, und nur wenn load() dabei geglueckt ist.
  const write = (what, call) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setBusy(true);
    (async () => {
      try {
        const result = await call();
        if (result && result.success === false) {
          setError(result.error || `${what} fehlgeschlagen.`);
          return;
        }
        await load();
      } catch (e) {
        setError(e?.message || `${what} fehlgeschlagen.`);
      } finally {
        setBusy(false);
        savingRef.current = false;
      }
    })();
    return true;
  };

  // „Aus Fach nehmen" raeumt genau das, was der Name sagt: Seite und Fach. Der Behaelter bleibt --
  // wer die Karte aus einem Fach nimmt, verliert sie nicht aus dem Ordner (in B1 war genau das ein
  // echter Datenverlust: eine Aktion tat mehr am Standort, als ihr Name ankuendigte). Das Exemplar
  // erscheint danach unter „Ohne Fach" und steht im Auswahlangebot jedes leeren Fachs dieses
  // Ordners ganz oben (binderGrid#candidateGroups). Geschrieben wird ueber denselben und einzigen
  // Standort-Weg; der Behaelter geht unveraendert wieder mit.
  const takeOut = (cp) => {
    const started = write('Aus Fach nehmen', () => window.api?.setCopyLocation?.({
      copy_id: cp.copy_id, container_id: cp.container_id, page: null, slot: null,
    }));
    if (started) setMenu(null);
  };

  const putIn = (cp, page, slot) => {
    const started = write('Einlegen', () => window.api?.setCopyLocation?.({
      copy_id: cp.copy_id, container_id: containerId, page, slot,
    }));
    if (started) { setFill(null); setQuery(''); }
  };

  const menuCopies = menu ? (slots(myCopies, menu.page, pockets)[menu.slot - 1] || []) : [];
  const groups = useMemo(
    () => candidateGroups(looseCopies, unsorted, query, nameOf),
    [looseCopies, unsorted, query, cardsByKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const renderPage = (page, pageSlots) => (
    <section className="flex-1 min-w-[220px]">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="font-mono text-xs text-muted">Seite {page}</span>
        <span className="font-mono text-xs text-accent">{fmtEUR(valueOf(pageSlots.flat()))}</span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {pageSlots.map((inSlot, i) => {
          const slot = i + 1;
          const first = inSlot[0];
          if (!first) {
            return (
              <button
                key={slot}
                type="button"
                title={`Seite ${page} · Fach ${slot} füllen`}
                onClick={() => { setQuery(''); setFill({ page, slot }); }}
                className="aspect-[0.68] rounded-md border-[1.5px] border-dashed border-line flex items-center justify-center text-muted hover:border-accent hover:text-accent transition-colors"
              >
                <Inbox className="w-5 h-5" />
              </button>
            );
          }
          return (
            <div
              key={slot}
              onClick={() => openCard(first)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, page, slot }); }}
              title={`${nameOf(first) || first.card_id} — Seite ${page} · Fach ${slot}`}
              className="relative aspect-[0.68] rounded-md overflow-hidden bg-bg cursor-pointer ring-1 ring-transparent hover:ring-accent transition-shadow"
            >
              {imageOf(first)
                ? <img src={imageOf(first)} alt={nameOf(first) || first.card_id} className="w-full h-full object-cover" />
                : <span className="absolute inset-0 flex items-center justify-center p-1 text-[10px] text-center text-muted">{nameOf(first) || first.card_id}</span>}
              {inSlot.length > 1 && (
                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-bg/90 text-[10px] font-mono text-text">
                  ×{inSlot.length}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  const copyRow = (cp) => (
    <button
      key={cp.copy_id}
      type="button"
      onClick={() => openCard(cp)}
      onContextMenu={(e) => { e.preventDefault(); setSheetCopy(cp); }}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bg text-left transition-colors"
    >
      <div className="w-8 h-11 bg-bg rounded overflow-hidden shrink-0">
        {imageOf(cp) && <img src={imageOf(cp)} alt="" className="w-full h-full object-cover" />}
      </div>
      <span className="flex-1 truncate text-sm text-text">{nameOf(cp) || cp.card_id}</span>
      <span className="text-xs text-muted font-mono shrink-0">{cp.set_code} · {cp.rarity} · {cp.condition}</span>
      <span className="text-xs text-muted font-mono shrink-0">
        {formatCopyLocation(cp, containers.find(c => c.container_id === cp.container_id))}
      </span>
    </button>
  );

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Ganz oben und in keinem zuklappbaren Bereich -- eine Fehlermeldung, die man erst
          aufklappen muss, ist keine. */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => navigate(ROUTES.binder)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface border border-line text-sm text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Behälter
        </button>
        <div className="min-w-0">
          <h2 className="font-display text-lg text-text truncate">{container?.name || 'Behälter'}</h2>
          <span className="text-xs text-muted">
            {container ? (KIND_LABELS[container.kind] || container.kind) : ''}
            {isBinder && container?.pockets_per_page ? ` · ${container.pockets_per_page} Fächer pro Seite` : ''}
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Wird geladen…</p>
      ) : !container ? (
        // Nur erreichbar, wenn der Behaelter geloescht wurde oder das Laden schiefging -- im
        // zweiten Fall sagt das Banner oben bereits, was war.
        !error && (
          <div className="flex-1 flex flex-col items-center justify-center text-muted">
            <PackageOpen className="w-16 h-16 mb-4 opacity-40" />
            <p>Diesen Behälter gibt es nicht (mehr).</p>
          </div>
        )
      ) : isBinder ? (
        <>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button" onClick={() => flip(-2)} disabled={leftPage <= 1}
              title="Vorherige Doppelseite (←)"
              className="p-2 rounded-lg bg-surface border border-line text-muted hover:text-text disabled:opacity-30 disabled:cursor-default"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-mono text-sm text-text">
              {rightPage ? `Seite ${leftPage}–${rightPage} von ${pages}` : `Seite ${leftPage} von ${pages}`}
            </span>
            <button
              type="button" onClick={() => flip(2)} disabled={leftPage >= lastLeft}
              title="Nächste Doppelseite (→)"
              className="p-2 rounded-lg bg-surface border border-line text-muted hover:text-text disabled:opacity-30 disabled:cursor-default"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <span className="font-mono text-sm text-accent ml-auto">{fmtEUR(openValue)}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {/* Umbricht im schmalen Fenster, statt die Seite seitlich scrollen zu lassen; der
                overflow-x-auto-Rahmen faengt ab, was selbst dann noch zu breit waere. */}
            <div className="overflow-x-auto">
              <div className="flex flex-wrap gap-6 items-start">
                {renderPage(leftPage, leftSlots)}
                {rightSlots
                  ? renderPage(rightPage, rightSlots)
                  : <div className="flex-1 min-w-[220px]" aria-hidden="true" />}
              </div>
            </div>

            {looseCopies.length > 0 && (
              <div className="mt-6">
                {/* Exemplare, die diesem Ordner zugeordnet sind, aber in keinem darstellbaren Fach
                    liegen (kein Fach vergeben, oder ein Fach aus einer frueheren, groesseren
                    Ordnergroesse). Ohne diese Liste waeren sie auf keiner Seite zu sehen. */}
                <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">Ohne Fach</h3>
                <div className="bg-surface border border-line rounded-xl p-2 space-y-1">
                  {looseCopies.map(copyRow)}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        // Box und Deckbox haben kein Raster: eine Liste aller Exemplare mit Standort-Chip.
        <>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm text-muted">
              {myCopies.length} {myCopies.length === 1 ? 'Exemplar' : 'Exemplare'}
            </span>
            <span className="font-mono text-sm text-accent ml-auto">{fmtEUR(valueOf(myCopies))}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {myCopies.length === 0 && !error ? (
              <div className="h-full flex flex-col items-center justify-center text-muted">
                <PackageOpen className="w-16 h-16 mb-4 opacity-40" />
                <p>Noch nichts in diesem Behälter.</p>
              </div>
            ) : (
              <div className="bg-surface border border-line rounded-xl p-2 space-y-1">
                {myCopies.map(copyRow)}
              </div>
            )}
          </div>
        </>
      )}

      {menu && menuCopies.length > 0 && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          className="z-[100] bg-bg border border-line rounded-xl shadow-sm p-2 min-w-[220px] max-w-[320px]"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-1 pb-1 text-xs font-mono text-muted">Seite {menu.page} · Fach {menu.slot}</p>
          {/* Auch bei einem einzelnen Exemplar je Zeile aufgefuehrt: liegen zwei im selben Fach,
              muss die Aktion sagen, welches gemeint ist -- ein Menue ohne Auswahl traefe eines von
              beiden auf gut Glueck. */}
          {menuCopies.map(cp => (
            <div key={cp.copy_id} className="pt-1 border-t border-line first:border-t-0">
              <p className="px-1 text-sm text-text truncate">{nameOf(cp) || cp.card_id}</p>
              <p className="px-1 text-[11px] font-mono text-muted truncate">
                {cp.set_code} · {cp.rarity} · {EDITION_LABELS[cp.edition] || cp.edition} · {cp.condition}
              </p>
              <div className="flex flex-col mt-1">
                <button type="button" disabled={busy} onClick={() => { setSheetCopy(cp); setMenu(null); }}
                        className="px-2 py-1.5 rounded-lg text-sm text-text hover:bg-surface text-left disabled:opacity-40">
                  Verschieben nach…
                </button>
                <button type="button" disabled={busy} onClick={() => takeOut(cp)}
                        className="px-2 py-1.5 rounded-lg text-sm text-bad hover:bg-bad/10 text-left disabled:opacity-40">
                  Aus Fach nehmen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {fill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm"
             onClick={() => { if (!busy) { setFill(null); setQuery(''); } }}>
          <div onClick={(e) => e.stopPropagation()}
               className="w-full max-w-md max-h-[85vh] bg-surface border border-line rounded-2xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-line flex items-center justify-between gap-2">
              <h3 className="font-display text-base text-text">In Seite {fill.page} · Fach {fill.slot} legen</h3>
              <button type="button" onClick={() => { setFill(null); setQuery(''); }} className="text-muted hover:text-text">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 pb-2">
              <input
                autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Exemplare durchsuchen"
                className="w-full bg-bg border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4">
              {candidatesEmpty(groups) ? (
                <p className="px-2 py-2 text-sm text-muted">
                  {looseCopies.length === 0 && unsorted.length === 0
                    ? 'Es ist nichts übrig, das hier hinein könnte.'
                    : 'Kein Exemplar passt zur Suche.'}
                </p>
              ) : (
                <>
                  {/* Zwei Gruppen: die Exemplare DIESES Ordners ohne Fach zuerst (sie sind der
                      Rueckweg fuer alles, was „Aus Fach nehmen" abgelegt hat), darunter die
                      Exemplare ohne Behaelter. Wer in welche Gruppe gehoert, rechnet
                      binderGrid#candidateGroups aus. */}
                  {groups.inContainer.length > 0 && (
                    <>
                      <p className="px-2 pt-2 pb-1 text-xs font-bold text-muted uppercase tracking-wider">In diesem Ordner, ohne Fach</p>
                      {groups.inContainer.map(cp => (
                        <CandidateRow key={cp.copy_id} copy={cp} name={nameOf(cp)} busy={busy}
                                      onPick={() => putIn(cp, fill.page, fill.slot)} />
                      ))}
                    </>
                  )}
                  {groups.unsorted.length > 0 && (
                    <>
                      <p className="px-2 pt-2 pb-1 text-xs font-bold text-muted uppercase tracking-wider">Nicht einsortiert</p>
                      {groups.unsorted.map(cp => (
                        <CandidateRow key={cp.copy_id} copy={cp} name={nameOf(cp)} busy={busy}
                                      onPick={() => putIn(cp, fill.page, fill.slot)} />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {sheetCopy && (
        // „Verschieben nach…" ist genau das, was CopySheet kann (Behaelter, Seite, Fach) -- und es
        // ist die einzige Schreibstelle fuer Tags und Notiz. Kein zweites Fenster mit denselben
        // Feldern.
        <CopySheet
          copy={sheetCopy}
          onClose={() => setSheetCopy(null)}
          onSaved={() => { load(); window.dispatchEvent(new Event('collection-dirty')); }}
        />
      )}
    </div>
  );
}

function CandidateRow({ copy, name, busy, onPick }) {
  return (
    <button
      type="button" disabled={busy} onClick={onPick}
      className={clsx(
        'w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors',
        busy ? 'opacity-40 cursor-default' : 'hover:bg-bg',
      )}
    >
      <span className="flex-1 truncate text-sm text-text">{name || copy.card_id}</span>
      <span className="text-xs text-muted font-mono shrink-0">{copy.set_code} · {copy.rarity} · {copy.condition}</span>
    </button>
  );
}
