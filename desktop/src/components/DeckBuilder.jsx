import { useState, useEffect, useMemo } from 'react';
import { Trash2, Save, FileUp, BarChart2, PieChart as PieChartIcon, Play } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
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
  const [showStats, setShowStats] = useState(false);
  const [testHand, setTestHand] = useState([]);
  const [showTestHand, setShowTestHand] = useState(false);

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

  const handleCreateDeck = async (e) => {
      e.preventDefault();
      if (!newDeckName.trim()) return;

      if (window.api) {
          const newDeck = await window.api.createDeck(newDeckName);
          setDecks([newDeck, ...decks]);
          setActiveDeck(newDeck);
          setMainDeck([]);
          setExtraDeck([]);
          setSideDeck([]);
          setNotes('');
          setIsCreating(false);
          setNewDeckName('');
      }
  };

  const handleLoadDeck = async (deck) => {
      if (window.api) {
          const details = await window.api.getDeckDetails(deck.id);
          setActiveDeck(deck);
          setNotes(deck.notes || '');

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
      if (!activeDeck || !window.api) return;
      // F1: name/image_url mitschicken -- sonst loescht "Save Deck" Katalognamen/-bilder nicht besessener
      // (importierter) Karten, weil save-deck fuer sie nur auf die lokale cards-Tabelle zurueckfallen kann.
      const allCards = buildSaveDeckCards({ mainDeck, extraDeck, sideDeck });
      // Spec E2 §5: Notizen nur mitschicken, wenn sie sich geaendert haben.
      const deckId = activeDeck.id;
      const notesChanged = notes !== (activeDeck.notes || '');
      try {
          await window.api.saveDeck(deckId, allCards, notesChanged ? notes : undefined);
      } catch (e) {
          alert(e.message || String(e));
          return;
      }
      if (notesChanged) {
          setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, notes } : d)));
          setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, notes } : prev));
      }
      reloadCoverage();   // Spec E1: die Deck-Liste rechnet mit den gespeicherten Deckkarten
      alert("Deck saved!");
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

  const drawTestHand = () => {
      // Create a flat array of all main deck cards based on quantity
      const deck = [];
      mainDeck.forEach(c => {
          for (let i = 0; i < c.quantity; i++) deck.push(c);
      });

      if (deck.length < 5) {
          alert("Main deck must have at least 5 cards.");
          return;
      }

      // Shuffle and pick 5
      const shuffled = [...deck].sort(() => 0.5 - Math.random());
      setTestHand(shuffled.slice(0, 5));
      setShowTestHand(true);
  };

  const addToDeck = (card) => {
      if (!activeDeck) {
          alert("Please select or create a deck first.");
          return;
      }
      // Spec E2 §6: Ziel "Side" oder "Deck" (Main/Extra per deckSectionFor).
      const section = addTarget === 'side' ? 'side' : deckSectionFor(card.type);
      const targetDeck = section === 'side' ? sideDeck : section === 'extra' ? extraDeck : mainDeck;
      const setTarget = section === 'side' ? setSideDeck : section === 'extra' ? setExtraDeck : setMainDeck;

      // Check limit (3 copies)
      const existing = targetDeck.find(c => c.card_id === card.id);
      if (existing) {
          if (existing.quantity >= 3) return;
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
      setTo((prev) => (prev.some((c) => c.card_id === card.card_id)
          ? prev.map((c) => (c.card_id === card.card_id ? { ...c, quantity: c.quantity + 1 } : c))
          : [...prev, { ...card, quantity: 1 }]));
  };

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

  const openFillBox = () => setDialog({
      kind: 'fill',
      proposal: fillBoxProposal({ deckId: activeDeck.id, deckCards: activeCards, copies: coverageData.copies, decks, containers: coverageData.containers }),
  });

  // Stats Components
  const deckStatsProps = { mainDeck, extraDeck, sideDeck };

  return (
    <div className="flex h-full gap-6">
        {/* Left: Deck List & Collection */}
        <div className="w-1/3 flex flex-col gap-4">
            <div className="bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 flex flex-col h-1/3">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-white">My Decks</h3>
                    <DeckNewMenu onEmpty={() => setIsCreating(true)} onYdkFile={handleImportYdk} onPaste={() => setImportSource({})} />
                </div>

                {isCreating && (
                    <form onSubmit={handleCreateDeck} className="mb-4 bg-black/40 p-3 rounded-lg border border-space-violet/50 animate-in fade-in slide-in-from-top-2">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Deck Name..."
                            className="w-full bg-[#1a1a1a] border border-gray-700 text-white px-3 py-2 rounded text-sm mb-2 focus:border-space-violet focus:outline-none"
                            value={newDeckName}
                            onChange={e => setNewDeckName(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="text-xs text-gray-400 hover:text-white px-2 py-1"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!newDeckName.trim()}
                                className="text-xs bg-space-violet hover:bg-space-violet-dark text-white px-3 py-1 rounded disabled:opacity-50"
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
                            className={`flex justify-between items-center p-2 rounded cursor-pointer ${activeDeck?.id === deck.id ? 'bg-space-violet/20 border border-space-violet/50 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        >
                            <div className="min-w-0">
                                <span className="block truncate">{deck.name}</span>
                                <span className="block truncate text-[11px] font-mono text-gray-500">
                                    {listCoverage ? `${boxLabel(deck, coverageData.containers)} · ${listText(listCoverage.get(deck.id))}` : LOADING}
                                </span>
                            </div>
                            {activeDeck?.id === deck.id && (
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteDeck(deck.id); }} className="text-gray-500 hover:text-red-400">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 flex flex-col flex-1 h-2/3">
                <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                    <span>Ziel:</span>
                    {[['deck', 'Deck'], ['side', 'Side']].map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setAddTarget(value)}
                            className={`px-2 py-1 rounded ${addTarget === value ? 'bg-space-violet text-white' : 'bg-gray-800 hover:text-white'}`}>
                            {label}
                        </button>
                    ))}
                </div>
                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Search Collection..."
                        className="w-full bg-[#1a1a1a] border border-gray-800 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-space-violet"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-3 gap-2 content-start">
                    {filteredCollection.map(card => (
                        <div key={card.id} onClick={() => addToDeck(card)} className="cursor-pointer group relative aspect-[2/3]">
                            <img src={card.image_url} alt={card.name} className="w-full h-full object-cover rounded border border-gray-800 group-hover:border-space-violet transition-colors" />
                            {/* Quantity badge */}
                            <div className="absolute bottom-0 right-0 bg-black/80 text-white text-[10px] px-1 font-mono">x{card.quantity}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Right: Active Deck Editor */}
        <div className="flex-1 bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 flex flex-col">
            {activeDeck ? (
                <>
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-white">{activeDeck.name}</h2>
                            <button
                                onClick={() => setShowStats(!showStats)}
                                className={`p-1.5 rounded-lg transition-colors ${showStats ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                                title="Toggle Stats"
                            >
                                {showStats ? <PieChartIcon className="w-4 h-4" /> : <BarChart2 className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={drawTestHand} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium border border-gray-700">
                                <Play className="w-4 h-4 mr-2" />
                                Test Hand
                            </button>
                            <DeckExportMenu deckName={activeDeck.name} entries={exportEntries} />
                            <button onClick={handleSaveDeck} className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors font-medium shadow-lg shadow-space-violet/20">
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
                        className="w-full mb-4 bg-black/30 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono focus:outline-none focus:border-space-violet"
                    />

                    {showStats && <DeckStats {...deckStatsProps} />}

                    {showTestHand && (
                        <div className="mb-6 p-4 bg-black/40 rounded-xl border border-gray-800 animate-in fade-in slide-in-from-top-4">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-sm font-bold text-white">Opening Hand (5 Cards)</h3>
                                <div className="flex gap-2">
                                    <button onClick={drawTestHand} className="text-xs text-space-violet hover:underline">Redraw</button>
                                    <button onClick={() => setShowTestHand(false)} className="text-xs text-gray-500 hover:text-white">Close</button>
                                </div>
                            </div>
                            <div className="flex gap-2 justify-center">
                                {testHand.map((card, idx) => (
                                    <div key={idx} className="w-20 aspect-[2/3] relative group animate-in zoom-in duration-300" style={{ animationDelay: `${idx * 50}ms` }}>
                                        <img src={card.image_url} alt="" className="w-full h-full object-cover rounded border border-gray-700 shadow-lg" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
                        {/* Main Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1 sticky top-0 bg-[#1E1E1E] z-10">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Main Deck</h3>
                                <span className="text-xs text-gray-500">{mainDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {mainDeck.length === 0 && <p className="text-gray-600 text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
                        </div>

                        {/* Extra Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1 sticky top-0 bg-[#1E1E1E] z-10">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Extra Deck</h3>
                                <span className="text-xs text-gray-500">{extraDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
                        </div>

                        {/* Side Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1 sticky top-0 bg-[#1E1E1E] z-10">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Side Deck</h3>
                                <span className="text-xs text-gray-500">{sideDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <FileUp className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">Select or Create a Deck</p>
                </div>
            )}
        </div>

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
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove }) => {
    const missing = !!numbers && numbers.missing > 0;

    return (
        <div
          onClick={() => removeFromDeck(card.card_id, type)}
          className="flex items-center justify-between p-2 hover:bg-red-500/10 rounded cursor-pointer group border-b border-gray-800"
        >
            <div className="flex items-center gap-2 overflow-hidden">
                <span className="font-bold text-gray-400 w-4">{card.quantity}</span>
                <div className="w-8 h-8 bg-black rounded overflow-hidden flex-shrink-0">
                    <img src={card.image_url} alt="" className="w-full h-full object-cover" />
                </div>
                <span className={`text-sm truncate ${missing ? 'text-red-400' : 'text-gray-300'}`}>{card.name}</span>
            </div>
            <div className="flex items-center gap-2">
                <DeckCardNumbers card={numbers} />
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(card, type); }}
                    className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 hover:text-white">
                    {moveLabel(type)}
                </button>
            </div>
        </div>
    );
};

const DeckStats = ({ mainDeck, extraDeck, sideDeck }) => {
    const allCards = [...mainDeck, ...extraDeck, ...sideDeck];
    // Type breakdown (Monster, Spell, Trap) - Main Deck Only usually matters for ratios
    let monsters = 0, spells = 0, traps = 0;
    mainDeck.forEach(c => {
        if (c.type && c.type.includes('Monster')) monsters += c.quantity;
        else if (c.type && c.type.includes('Spell')) spells += c.quantity;
        else if (c.type && c.type.includes('Trap')) traps += c.quantity;
    });

    const typeData = [
        { name: 'Monster', value: monsters, color: '#A68349' }, // Orange/Brown
        { name: 'Spell', value: spells, color: '#1D9E74' },   // Green
        { name: 'Trap', value: traps, color: '#BC5A84' }     // Pink
    ].filter(d => d.value > 0);

    // Attribute breakdown (All cards)
    const attrCounts = {};
    allCards.forEach(c => {
        if (c.attribute) {
            attrCounts[c.attribute] = (attrCounts[c.attribute] || 0) + c.quantity;
        }
    });
    const attrData = Object.keys(attrCounts).map(k => ({ name: k, value: attrCounts[k] }));

    return (
        <div className="grid grid-cols-2 gap-4 h-64 mb-4">
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Card Types (Main)</h4>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                            {typeData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                            ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Attributes</h4>
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={attrData}>
                        <XAxis dataKey="name" stroke="#666" fontSize={10} />
                        <YAxis stroke="#666" fontSize={10} />
                        <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                        <Bar dataKey="value" fill="#9D00FF" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};