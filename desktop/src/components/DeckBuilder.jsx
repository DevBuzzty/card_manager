import { useState, useEffect, useMemo } from 'react';
import { Trash2, Save, FileUp, Star, Tag } from 'lucide-react';
import { LOADING, boxLabel, deckCoverage, listText } from '../utils/deckCoverage';
import { fillBoxProposal } from '../utils/fillBoxProposal';
import DeckCoverageHeader from './DeckCoverageHeader';
import DeckCardNumbers from './DeckCardNumbers';
import FillBoxDialog from './FillBoxDialog';
import DeckWishlistDialog from './DeckWishlistDialog';
import DeckNewMenu from './DeckNewMenu';
import DeckImportDialog from './DeckImportDialog';
import DeckExportMenu from './DeckExportMenu';
import { deckSectionFor, moveLabel, moveTarget } from '../utils/deckImport';
import { buildSaveDeckCards } from '../utils/saveDeckPayload';
import CustomSelect from './CustomSelect';
import DeckSidebar from './DeckSidebar';
import DeckLegalityBadge from './DeckLegalityBadge';
import DeckBanIcon from './DeckBanIcon';
import { COPY_LIMIT, FORMATS, FORMAT_LABELS, banOf, canAddCopy, deckLegality, normalizeFormat } from '../utils/deckLegality';

const FORMAT_OPTIONS = FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }));

// Spec E1 §4: alles, was der Abgleich braucht, in einem Rutsch -- lokale Exemplare und Behaelter, alle Deckkarten
// aus der Cloud, Katalogpreise. Die Decks selbst kommen wie bisher ueber getDecks.
function fetchCoverageData() {
  return Promise.all([window.api.listDeckCopies(), window.api.getAllDeckCards(), window.api.getCatalogPrices()])
    .then(([local, deckCards, catalog]) => ({ copies: local.copies, containers: local.containers, deckCards: deckCards || [], prices: catalog.prices }));
}

export default function DeckBuilder() {
  const [decks, setDecks] = useState([]);
  // Spec E1 §8: bis Decks UND Abgleichsdaten da sind, zeigen alle Zahlen "…" -- nie 0/40.
  const [decksLoaded, setDecksLoaded] = useState(false);
  const [coverageData, setCoverageData] = useState(null);
  const [coverageError, setCoverageError] = useState(null);
  const [boxError, setBoxError] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'fill', proposal } | { kind: 'wishlist' } | null
  const [activeDeck, setActiveDeck] = useState(null); // { id, name, cards: [] }
  const [collection, setCollection] = useState([]);
  const [filter, setFilter] = useState('');
  // Spec E3: Format des offenen Decks (gespeichert mit "Save Deck"), Katalog-Index fuer die Legalitaet (null = laedt),
  // Meldung der Kopien-Grenze beim Hinzufuegen.
  const [format, setFormat] = useState('tcg');
  const [legalityData, setLegalityData] = useState(null);
  const [limitMessage, setLimitMessage] = useState(null);
  // F1: Schutz gegen Doppelklick auf "Save Deck" (verdoppelte Zeilen).
  const [saving, setSaving] = useState(false);

  // Deck Creation State
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');

  // Spec E2: Import-Dialog ({ text, name, format } fuer die YDK-Datei, {} fuer Einfuegen), Ziel beim Hinzufuegen, Notizen.
  const [importSource, setImportSource] = useState(null);
  const [addTarget, setAddTarget] = useState('deck');
  const [notes, setNotes] = useState('');

  // Deck State
  const [mainDeck, setMainDeck] = useState([]);
  const [extraDeck, setExtraDeck] = useState([]);
  const [sideDeck, setSideDeck] = useState([]);

  useEffect(() => {
    if (window.api) {
        window.api.getDecks().then((d) => { setDecks(d); setDecksLoaded(true); });
        window.api.getCollection().then(setCollection);
        fetchCoverageData().then(setCoverageData).catch((e) => setCoverageError(e.message || String(e)));
        // F7: ohne .catch bleibt legalityData fuer immer null (Endlos-"…") statt "Katalog fehlt – Banlist unbekannt".
        window.api.getCatalogLegality().then(setLegalityData).catch(() => setLegalityData({ available: false }));
    }
  }, []);

  // Spec E1 §12.4: zieht der Sync Exemplar-Aenderungen vom Handy herein, stimmen Ort und Zahlen auch hier.
  useEffect(() => window.api?.onCollectionChanged?.(() => {
      fetchCoverageData().then(setCoverageData).catch((e) => setCoverageError(e.message || String(e)));
  }), []);

  const reloadCoverage = () => fetchCoverageData()
      .then((d) => { setCoverageData(d); setCoverageError(null); })
      .catch((e) => setCoverageError(e.message || String(e)));

  const ready = decksLoaded && !!coverageData;
  // Spec E3 §3/§8: ohne (E3-)Katalog null -> "Katalog fehlt – Banlist unbekannt", keine Icons, Artworks einzeln.
  const legalityCatalog = useMemo(() => (legalityData && legalityData.available
      ? { aliases: legalityData.aliases, cards: legalityData.cards } : null), [legalityData]);

  // Deck-Liste: gespeicherte Deckkarten je Deck (nicht die ungespeicherten Aenderungen im Editor).
  const listCoverage = useMemo(() => {
      if (!ready) return null;
      const byDeck = new Map();
      for (const dc of coverageData.deckCards) {
          if (!byDeck.has(dc.deck_id)) byDeck.set(dc.deck_id, []);
          byDeck.get(dc.deck_id).push(dc);
      }
      return new Map(decks.map((d) => [d.id, deckCoverage({
          deckId: d.id, deckCards: byDeck.get(d.id) || [], copies: coverageData.copies,
          decks, containers: coverageData.containers, prices: coverageData.prices,
      })]));
  }, [ready, coverageData, decks]);

  // Spec E3 §7: Badge der Deck-Liste aus den gespeicherten Deckkarten und dem gespeicherten Format.
  const listLegality = useMemo(() => {
      if (!ready || !legalityData) return null;
      const byDeck = new Map();
      for (const dc of coverageData.deckCards) {
          if (!byDeck.has(dc.deck_id)) byDeck.set(dc.deck_id, []);
          byDeck.get(dc.deck_id).push(dc);
      }
      return new Map(decks.map((d) => [d.id, deckLegality(byDeck.get(d.id) || [], d.format, legalityCatalog)]));
  }, [ready, coverageData, decks, legalityData, legalityCatalog]);

  const handleCreateDeck = async (e) => {
      e.preventDefault();
      if (!newDeckName.trim()) return;

      if (window.api) {
          const newDeck = await window.api.createDeck(newDeckName);
          setDecks([newDeck, ...decks]);
          setActiveDeck(newDeck);
          setFormat(normalizeFormat(newDeck.format));
          setMainDeck([]);
          setExtraDeck([]);
          setSideDeck([]);
          setNotes('');
          setIsCreating(false);
          setNewDeckName('');
          // F8: Kopien-Grenzen-Meldung des vorherigen Decks darf am neuen nicht stehen bleiben.
          setLimitMessage(null);
      }
  };

  const handleLoadDeck = async (deck) => {
      if (window.api) {
          const details = await window.api.getDeckDetails(deck.id);
          setActiveDeck(deck);
          setNotes(deck.notes || '');
          setFormat(normalizeFormat(deck.format));
          setLimitMessage(null);

          const main = [], extra = [], side = [];
          details.forEach(c => {
              if (c.type === 'extra') extra.push(c);
              else if (c.type === 'side') side.push(c);
              else main.push(c);
          });
          setMainDeck(main);
          setExtraDeck(extra);
          setSideDeck(side);
      }
  };

  const handleDeleteDeck = async (id) => {
      if (!confirm("Delete this deck?")) return;
      if (window.api) {
          await window.api.deleteDeck(id);
          setDecks(decks.filter(d => d.id !== id));
          if (activeDeck && activeDeck.id === id) setActiveDeck(null);
      }
  };

  const handleSaveDeck = async () => {
      // F1: Schutz am Anfang, nicht nur ueber `disabled` -- ein zweiter Aufruf waehrend eines laufenden
      // Speicherns kehrt sofort zurueck (sonst verdoppelt ein Doppelklick die Deckkarten-Zeilen).
      if (!activeDeck || !window.api || saving) return;
      setSaving(true);
      try {
          // F1: name/image_url mitschicken -- sonst loescht "Save Deck" Katalognamen/-bilder nicht besessener
          // (importierter) Karten, weil save-deck fuer sie nur auf die lokale cards-Tabelle zurueckfallen kann.
          const allCards = buildSaveDeckCards({ mainDeck, extraDeck, sideDeck });
          // Spec E2 §5: Notizen nur mitschicken, wenn sie sich geaendert haben.
          const deckId = activeDeck.id;
          const notesChanged = notes !== (activeDeck.notes || '');
          // Spec E3 §4/§8: Format nur mitschicken, wenn es sich geaendert hat (vor decks_format_role.sql zaehlt alles als TCG).
          const formatChanged = format !== normalizeFormat(activeDeck.format);
          // F2: saveDeck wirft bei einem gescheiterten Format-Update nicht mehr -- Karten und Notizen sind
          // dann schon gespeichert, also werden Notizen-Stand und Abgleich immer aktualisiert; nur das Format
          // wird bei formatError NICHT uebernommen (es steht ja nicht wirklich in der Cloud).
          const result = await window.api.saveDeck(deckId, allCards, notesChanged ? notes : undefined, formatChanged ? format : undefined);
          if (notesChanged) {
              setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, notes } : d)));
              setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, notes } : prev));
          }
          if (formatChanged && !result.formatError) {
              setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, format } : d)));
              setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, format } : prev));
          }
          reloadCoverage();   // Spec E1: die Deck-Liste rechnet mit den gespeicherten Deckkarten
          alert(result.formatError || "Deck saved!");
      } catch (e) {
          alert(e.message || String(e));
      } finally {
          setSaving(false);
      }
  };

  // Spec E1 §3/§9: Deckbox zuordnen. Lehnt die Cloud ab (Unique-Index), bleibt alles, wie es war, und die Meldung steht.
  const handleChangeBox = async (containerId) => {
      if (!activeDeck || !window.api) return;
      const deckId = activeDeck.id;
      setBoxError(null);
      try {
          const res = await window.api.setDeckContainer({ deckId, containerId: containerId || null });
          if (!res.success) { setBoxError(res.error); return; }
          setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, container_id: containerId || null } : d)));
          // F2: waehrend des Netzwegs kann der Nutzer ein anderes Deck geoeffnet haben -- dessen activeDeck darf
          // nicht die Box-ID dieses (fremden) Aufrufs bekommen.
          setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, container_id: containerId || null } : prev));
      } catch (e) {
          setBoxError(e.message || String(e));
      }
  };

  // Spec E2 §5: YDK-Datei lesen (Hauptprozess), parsen und aufloesen im Import-Dialog.
  const handleImportYdk = async () => {
      if (!window.api) return;
      const result = await window.api.importDeckYdk();
      if (result && !result.canceled) setImportSource({ text: result.text, name: result.name, format: 'ydk' });
  };

  // Spec E2 §5: das neue Deck steht vorn in der Liste und ist im Editor offen.
  const handleImported = (deck) => {
      setImportSource(null);
      setDecks((prev) => [deck, ...prev]);
      handleLoadDeck(deck);
      reloadCoverage();
  };

  // Spec E2 §6: Export aus dem Editor-Stand (auch ungespeichert).
  const exportEntries = useMemo(() => [
      ...mainDeck.map((c) => ({ passcode: String(c.card_id), name: c.name, count: c.quantity, section: 'main' })),
      ...extraDeck.map((c) => ({ passcode: String(c.card_id), name: c.name, count: c.quantity, section: 'extra' })),
      ...sideDeck.map((c) => ({ passcode: String(c.card_id), name: c.name, count: c.quantity, section: 'side' })),
  ], [mainDeck, extraDeck, sideDeck]);

  const addToDeck = (card) => {
      if (!activeDeck) {
          alert("Please select or create a deck first.");
          return;
      }
      // Spec E2 §6: Ziel "Side" oder "Deck" (Main/Extra per deckSectionFor).
      const section = addTarget === 'side' ? 'side' : deckSectionFor(card.type);
      const targetDeck = section === 'side' ? sideDeck : section === 'extra' ? extraDeck : mainDeck;
      const setTarget = section === 'side' ? setSideDeck : section === 'extra' ? setExtraDeck : setMainDeck;

      // Spec E3 §5: hoechstens 3 Kopien je Karte ueber alle Abschnitte (Haupt-Passcode), im Format "Frei" ohne Grenze.
      const current = [...mainDeck, ...extraDeck, ...sideDeck].map((c) => ({ card_id: String(c.card_id), count: c.quantity }));
      if (!canAddCopy(current, card.id, format, legalityCatalog ? legalityCatalog.aliases : null)) {
          setLimitMessage(COPY_LIMIT);
          return;
      }
      setLimitMessage(null);
      const existing = targetDeck.find(c => c.card_id === card.id);
      if (existing) {
          setTarget(prev => prev.map(c => c.card_id === card.id ? { ...c, quantity: c.quantity + 1 } : c));
      } else {
          setTarget(prev => [...prev, { ...card, card_id: card.id, card_type: card.type, quantity: 1 }]);
      }
  };

  const removeFromDeck = (cardId, deckType) => {
      const setter = deckType === 'main' ? setMainDeck : (deckType === 'extra' ? setExtraDeck : setSideDeck);
      setter(prev => {
          const existing = prev.find(c => c.card_id === cardId);
          if (existing.quantity > 1) {
              return prev.map(c => c.card_id === cardId ? { ...c, quantity: c.quantity - 1 } : c);
          }
          return prev.filter(c => c.card_id !== cardId);
      });
  };

  // Spec E2 §6: eine Kopie verschieben -- "→ Side" aus Main/Extra, "→ Deck" aus Side (Main/Extra per Kartentyp).
  const moveOne = (card, from) => {
      const to = moveTarget(from, card.card_type);
      const setTo = to === 'side' ? setSideDeck : to === 'extra' ? setExtraDeck : setMainDeck;
      removeFromDeck(card.card_id, from);
      // Spec E3 §6: Starter gibt es nur im Main Deck -- eine verschobene Kopie nimmt den Stern nicht mit.
      setTo((prev) => (prev.some((c) => c.card_id === card.card_id)
          ? prev.map((c) => (c.card_id === card.card_id ? { ...c, quantity: c.quantity + 1 } : c))
          : [...prev, { ...card, quantity: 1, role: null }]));
  };

  // Spec E3 §6: Starter-Stern an Main-Deck-Zeilen (gespeichert mit "Save Deck").
  const toggleStarter = (cardId) => setMainDeck((prev) => prev.map((c) => (
      c.card_id === cardId ? { ...c, role: c.role === 'starter' ? null : 'starter' } : c)));

  const filteredCollection = collection.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));

  // Spec E1 §4/§8: Abgleich des geoeffneten Decks mit den Karten, wie sie gerade im Editor stehen.
  const activeCards = useMemo(() => [
      ...mainDeck.map((c) => ({ card_id: String(c.card_id), count: c.quantity, section: 'main' })),
      ...extraDeck.map((c) => ({ card_id: String(c.card_id), count: c.quantity, section: 'extra' })),
      ...sideDeck.map((c) => ({ card_id: String(c.card_id), count: c.quantity, section: 'side' })),
  ], [mainDeck, extraDeck, sideDeck]);
  const activeCoverage = useMemo(() => (ready && activeDeck ? deckCoverage({
      deckId: activeDeck.id, deckCards: activeCards, copies: coverageData.copies,
      decks, containers: coverageData.containers, prices: coverageData.prices,
  }) : null), [ready, activeDeck, activeCards, coverageData, decks]);
  const coverageByCard = useMemo(() => new Map((activeCoverage ? activeCoverage.cards : []).map((c) => [c.card_id, c])), [activeCoverage]);
  const deckCardInfo = useMemo(() => new Map([...mainDeck, ...extraDeck, ...sideDeck].map((c) => [String(c.card_id), c])), [mainDeck, extraDeck, sideDeck]);
  const copiesById = useMemo(() => new Map((coverageData ? coverageData.copies : []).map((c) => [c.copy_id, c])), [coverageData]);
  const containersById = useMemo(() => new Map((coverageData ? coverageData.containers : []).map((c) => [c.container_id, c])), [coverageData]);
  const numbersFor = (cardId) => (activeCoverage ? coverageByCard.get(String(cardId)) : null);
  // Spec H1 §5.3: markierte Exemplare bleiben verfuegbar, die Deckzeile zeigt das Preisschild (gleicher Schluessel wie der Abgleich).
  const forSaleCards = useMemo(() => new Set((coverageData ? coverageData.copies : []).filter((c) => c.for_sale).map((c) => String(c.card_id))), [coverageData]);

  // Spec E3 §7: Legalitaet aus dem UNGESPEICHERTEN Editor-Stand; null, solange der Katalog-Index laedt.
  const legalityCards = useMemo(() => [
      ...mainDeck.map((c) => ({ card_id: String(c.card_id), name: c.name, count: c.quantity, section: 'main' })),
      ...extraDeck.map((c) => ({ card_id: String(c.card_id), name: c.name, count: c.quantity, section: 'extra' })),
      ...sideDeck.map((c) => ({ card_id: String(c.card_id), name: c.name, count: c.quantity, section: 'side' })),
  ], [mainDeck, extraDeck, sideDeck]);
  const activeLegality = useMemo(() => (legalityData ? deckLegality(legalityCards, format, legalityCatalog) : null),
      [legalityCards, format, legalityData, legalityCatalog]);
  const banFor = (cardId) => banOf(cardId, format, legalityCatalog);

  const openFillBox = () => setDialog({
      kind: 'fill',
      proposal: fillBoxProposal({ deckId: activeDeck.id, deckCards: activeCards, copies: coverageData.copies, decks, containers: coverageData.containers }),
  });

  return (
    <div className="flex h-full gap-6">
        {/* Left: Deck List & Collection */}
        <div className="w-1/3 flex flex-col gap-4">
            <div className="bg-surface p-4 rounded-xl border border-line flex flex-col h-1/3">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-text">My Decks</h3>
                    <DeckNewMenu onEmpty={() => setIsCreating(true)} onYdkFile={handleImportYdk} onPaste={() => setImportSource({})} />
                </div>

                {isCreating && (
                    <form onSubmit={handleCreateDeck} className="mb-4 bg-bg p-3 rounded-lg border border-accent/50 animate-in fade-in slide-in-from-top-2">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Deck Name..."
                            className="w-full bg-bg border border-line text-text px-3 py-2 rounded text-sm mb-2 focus:border-accent focus:outline-none"
                            value={newDeckName}
                            onChange={e => setNewDeckName(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="text-xs text-muted hover:text-text px-2 py-1"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!newDeckName.trim()}
                                className="text-xs bg-surface-2 hover:bg-bg border border-line text-text px-3 py-1 rounded disabled:opacity-50"
                            >
                                Create
                            </button>
                        </div>
                    </form>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                    {decks.map(deck => (
                        <div
                            key={deck.id}
                            onClick={() => handleLoadDeck(deck)}
                            className={`flex justify-between items-center p-2 rounded cursor-pointer ${activeDeck?.id === deck.id ? 'bg-accent/20 border border-accent/50 text-text' : 'hover:bg-surface-2 text-muted'}`}
                        >
                            <div className="min-w-0">
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="truncate">{deck.name}</span>
                                    <DeckLegalityBadge showFormat format={deck.format} result={listLegality ? listLegality.get(deck.id) : null} />
                                </span>
                                <span className="block truncate text-[11px] font-mono text-muted">
                                    {listCoverage ? `${boxLabel(deck, coverageData.containers)} · ${listText(listCoverage.get(deck.id))}` : LOADING}
                                </span>
                            </div>
                            {activeDeck?.id === deck.id && (
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteDeck(deck.id); }} className="text-muted hover:text-bad">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-surface p-4 rounded-xl border border-line flex flex-col flex-1 h-2/3">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                    <span>Ziel:</span>
                    {[['deck', 'Deck'], ['side', 'Side']].map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setAddTarget(value)}
                            className={`px-2 py-1 rounded ${addTarget === value ? 'bg-accent text-accent-fg' : 'bg-surface-2 hover:text-accent'}`}>
                            {label}
                        </button>
                    ))}
                    {limitMessage && <span className="text-bad">{limitMessage}</span>}
                </div>
                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Search Collection..."
                        className="w-full bg-bg border border-line text-text px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-accent"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-3 gap-2 content-start">
                    {filteredCollection.map(card => (
                        <div key={card.id} onClick={() => addToDeck(card)} className="cursor-pointer group relative aspect-[2/3]">
                            <img src={card.image_url} alt={card.name} className="w-full h-full object-cover rounded border border-line group-hover:border-accent transition-colors" />
                            {/* Quantity badge */}
                            <div className="absolute bottom-0 right-0 bg-bg/80 text-text text-[10px] px-1 font-mono">x{card.quantity}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Right: Active Deck Editor */}
        <div className="flex-1 bg-surface p-6 rounded-2xl border border-line flex flex-col">
            {activeDeck ? (
                <>
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-text">{activeDeck.name}</h2>
                            <CustomSelect className="w-24" value={format} onChange={(f) => { setFormat(normalizeFormat(f)); setLimitMessage(null); }} options={FORMAT_OPTIONS} />
                            <DeckLegalityBadge format={format} result={activeLegality} />
                        </div>
                        <div className="flex gap-2">
                            <DeckExportMenu deckName={activeDeck.name} entries={exportEntries} />
                            <button onClick={handleSaveDeck} disabled={saving} className="flex items-center px-4 py-2 bg-accent hover:brightness-110 text-accent-fg rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                                <Save className="w-4 h-4 mr-2" />
                                Save Deck
                            </button>
                        </div>
                    </div>

                    <DeckCoverageHeader
                        deck={activeDeck} decks={decks} coverage={activeCoverage}
                        containers={coverageData ? coverageData.containers : null}
                        error={coverageError} boxError={boxError}
                        onChangeBox={handleChangeBox}
                        onOpenWishlist={() => setDialog({ kind: 'wishlist' })}
                        onOpenFillBox={openFillBox}
                    />

                    <textarea
                        value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notizen" rows={notes ? 3 : 1}
                        className="w-full mb-4 bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
                    />

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
                        {/* Main Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-line pb-1 sticky top-0 bg-surface z-10">
                                <h3 className="text-sm font-bold uppercase text-muted">Main Deck</h3>
                                <span className="text-xs text-muted">{mainDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {mainDeck.length === 0 && <p className="text-muted text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} onToggleStarter={toggleStarter} forSale={forSaleCards.has(String(c.card_id))} />)}
                            </div>
                        </div>

                        {/* Extra Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-line pb-1 sticky top-0 bg-surface z-10">
                                <h3 className="text-sm font-bold uppercase text-muted">Extra Deck</h3>
                                <span className="text-xs text-muted">{extraDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} forSale={forSaleCards.has(String(c.card_id))} />)}
                            </div>
                        </div>

                        {/* Side Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-line pb-1 sticky top-0 bg-surface z-10">
                                <h3 className="text-sm font-bold uppercase text-muted">Side Deck</h3>
                                <span className="text-xs text-muted">{sideDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} forSale={forSaleCards.has(String(c.card_id))} />)}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted">
                    <FileUp className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">Select or Create a Deck</p>
                </div>
            )}
        </div>

        {activeDeck && (
            <DeckSidebar mainDeck={mainDeck} extraDeck={extraDeck} sideDeck={sideDeck} legality={activeLegality}
                builtAt={legalityData && legalityData.available ? legalityData.builtAt : null} />
        )}

        {dialog && dialog.kind === 'fill' && activeCoverage && (
            <FillBoxDialog
                boxId={activeCoverage.boxId}
                boxName={boxLabel(activeDeck, coverageData.containers)}
                proposal={dialog.proposal} copiesById={copiesById} containersById={containersById}
                onClose={() => setDialog(null)} onMoved={reloadCoverage}
                onOpenWishlist={() => setDialog({ kind: 'wishlist' })}
            />
        )}
        {importSource && (
            <DeckImportDialog source={importSource} onClose={() => setImportSource(null)} onCreated={handleImported} />
        )}
        {dialog && dialog.kind === 'wishlist' && activeCoverage && (
            <DeckWishlistDialog coverage={activeCoverage} cardInfo={deckCardInfo} onClose={() => setDialog(null)} />
        )}
    </div>
  );
}

// Sub-component for a card row in deck list
// Spec E1 §8: statt des roten "fehlt" die drei Zahlen aus dem Abgleich (numbers null = noch nicht geladen).
// Spec E3 §7: Banlist-Icon nach Format; Main-Deck-Zeilen mit Starter-Stern (onToggleStarter nur dort).
// Spec H1 §5.3: forSale = mindestens ein Exemplar dieses Passcodes ist zum Verkauf markiert (Preisschild).
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove, ban, onToggleStarter, forSale }) => {
    const missing = !!numbers && numbers.missing > 0;

    return (
        <div
          onClick={() => removeFromDeck(card.card_id, type)}
          className="flex items-center justify-between p-2 hover:bg-bad/10 rounded cursor-pointer group border-b border-line"
        >
            <div className="flex items-center gap-2 overflow-hidden">
                <span className="font-bold text-muted w-4">{card.quantity}</span>
                <div className="w-8 h-8 bg-bg rounded overflow-hidden flex-shrink-0">
                    <img src={card.image_url} alt="" className="w-full h-full object-cover" />
                </div>
                <span className={`text-sm truncate ${missing ? 'text-bad' : 'text-text'}`}>{card.name}</span>
                <DeckBanIcon ban={ban} />
                {forSale && <Tag className="w-3.5 h-3.5 text-warn shrink-0" aria-label="Zum Verkauf markiert" />}
            </div>
            <div className="flex items-center gap-2">
                <DeckCardNumbers card={numbers} />
                {onToggleStarter && (
                    <button type="button" title="Starter" onClick={(e) => { e.stopPropagation(); onToggleStarter(card.card_id); }}
                        className={card.role === 'starter' ? 'text-warn' : 'text-muted hover:text-text'}>
                        <Star className="w-4 h-4" fill={card.role === 'starter' ? 'currentColor' : 'none'} />
                    </button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(card, type); }}
                    className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted hover:text-text">
                    {moveLabel(type)}
                </button>
            </div>
        </div>
    );
};
