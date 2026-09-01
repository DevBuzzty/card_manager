import { useEffect, useCallback, useState, useRef } from 'react';
import { Check, X, Loader2, AlertCircle, FileSpreadsheet, Minus, Plus, HelpCircle, Edit } from 'lucide-react';
import { playScanSound } from '../utils/sound';
import CustomSelect from './CustomSelect';
import RarityGuide from './RarityGuide';
import CardSearchModal from './CardSearchModal';
import { Search } from 'lucide-react';
import { matchCandidates } from '../utils/setCodeMatch';
import Flag from './Flag';

// Merge a card's printings from all sources into ONE flagged list: German (wiki+Konami) + English
// (YGOPRODeck, with prices) + Japanese (wiki+Konami). Each entry carries its language so the picker
// can show a flag and the commit knows the language. Deduped by code+rarity+language.
function mergePrintings(cardSets, germanSets, japaneseSets) {
    const de = (germanSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price || 0, language: 'DE', isYugipedia: true }));
    const en = (cardSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price, language: 'EN' }));
    const jp = (japaneseSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price || 0, language: 'JP', isYugipedia: true }));
    const seen = new Set();
    const out = [];
    for (const s of [...de, ...en, ...jp]) {
        const key = `${s.set_code}|${s.set_rarity}|${s.language}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

const printingKey = (s) => s ? `${s.set_code}|${s.set_rarity}|${s.language}` : '';

// One dropdown listing EVERY printing of the card, each prefixed with its country flag — no
// separate language selector. Shared by a card's primary printing and its extra printings.
function PrintingPicker({ printings, selectedSet, onSelect, loading }) {
    if (!printings || printings.length === 0) {
        return (
            <div className="flex-1 bg-gray-800 rounded px-2 py-1 text-xs text-gray-400 border border-gray-700 flex items-center justify-center">
                {loading ? 'Lade Druckvarianten…' : 'Keine Druckvarianten gefunden'}
            </div>
        );
    }
    return (
        <div className="flex-1">
            <CustomSelect
                value={printingKey(selectedSet)}
                onChange={(val) => onSelect(printings.find(s => printingKey(s) === val))}
                placeholder="Druckvariante wählen"
                options={printings.map((s, i) => ({
                    value: printingKey(s),
                    // Separate the language groups (DE | EN | JP) with a thin divider + spacing.
                    divider: i > 0 && printings[i - 1].language !== s.language,
                    label: (
                        <span className="inline-flex items-center gap-1.5">
                            <Flag lang={s.language} />
                            {`${s.set_code} - ${s.set_rarity}${s.language === 'EN' && s.set_price ? ` ($${s.set_price})` : ''}`}
                        </span>
                    )
                }))}
                className="w-full"
            />
        </div>
    );
}

export default function StagingArea({ scannedCards, setScannedCards, isUpdating }) {
  const [showRarityGuide, setShowRarityGuide] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const fetchCard = useCallback(async (tempId, passcode) => {
    // Set loading immediately to prevent double fetch
    setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, status: 'loading' } : c));

    if (!window.api) {
        // Mock (browser dev, window.api undefined)
        return new Promise(resolve => setTimeout(() => {
             setScannedCards(prev => prev.map(c => c.tempId === tempId ? {
                 ...c,
                 status: 'loaded',
                 data: { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', race: 'Dragon', card_images: [{ image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }] },
                 language: 'DE'
             } : c));
             resolve();
        }, 1000));
    }

    try {
        // Card data and the local ownership check run in parallel (Yugipedia is deferred below).
        const [data, result] = await Promise.all([
            window.api.fetchCardData(passcode),
            window.api.checkCardExists(passcode),
        ]);

        if (!data || data.error) {
            setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
            return;
        }

        // Show the card immediately with the English printings; German + Japanese load right after.
        setScannedCards(prev => prev.map(c => {
            if (c.tempId !== tempId) return c;
            const apiMatch = matchCandidates(c.scannedSetCandidates, data.card_sets);
            const enPrintings = mergePrintings(data.card_sets, [], []);
            return {
                ...c,
                status: 'loaded',
                data,
                allPrintings: enPrintings,
                loadingSets: true,
                inCollection: result.exists,
                ownedQuantity: result.quantity,
                selectedSet: c.selectedSet || (apiMatch.set ? { ...apiMatch.set, language: 'EN' } : (enPrintings[0] || null)),
                setAutoDetected: apiMatch.confidence !== 'none',
                setMatchConfidence: apiMatch.confidence
            };
        }));
        playScanSound();

        // Fetch German + Japanese printings in the background and merge into one flagged list.
        Promise.all([
            window.api.fetchYugipediaSets(passcode).then(s => s || []).catch(() => []),
            window.api.fetchJapaneseSets(passcode).then(s => s || []).catch(() => []),
        ]).then(([germanSets, japaneseSets]) => {
            setScannedCards(prev => prev.map(c => {
                if (c.tempId !== tempId) return c;
                const allPrintings = mergePrintings(c.data.card_sets, germanSets, japaneseSets);
                const keepSelection = c.setTouched || c.isManualEntry;
                let chosen = c.selectedSet;
                let auto = c.setAutoDetected;
                let confidence = c.setMatchConfidence;
                if (!keepSelection) {
                    // Prefer the German printing that matches the scanned set code (collection is DE-first).
                    const deMatch = matchCandidates(c.scannedSetCandidates, germanSets);
                    if (deMatch && deMatch.set) {
                        chosen = { ...deMatch.set, language: 'DE', isYugipedia: true };
                        auto = true;
                        confidence = deMatch.confidence;
                    } else if (germanSets.length > 0 && !c.setAutoDetected) {
                        chosen = { ...germanSets[0], language: 'DE', isYugipedia: true };
                    }
                }
                return { ...c, loadingSets: false, allPrintings, selectedSet: chosen, setAutoDetected: auto, setMatchConfidence: confidence };
            }));
        }).catch(() => {
            setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, loadingSets: false } : c));
        });
    } catch (e) {
        setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
    }
  }, [setScannedCards]);

  // Process pending scans with a concurrency cap so a large CSV import doesn't storm the APIs.
  const MAX_CONCURRENT_FETCHES = 5;
  const inFlightRef = useRef(0);
  // Guards handleAdd against re-entrant calls for the same card (e.g. OS key-repeat on Enter).
  const committingRef = useRef(new Set());

  useEffect(() => {
    const pending = scannedCards.filter(c => c.status === 'pending');
    if (pending.length === 0) return;
    let available = MAX_CONCURRENT_FETCHES - inFlightRef.current;
    for (const card of pending) {
      if (available <= 0) break;
      available--;
      inFlightRef.current++;
      fetchCard(card.tempId, card.passcode).finally(() => { inFlightRef.current--; });
    }
  }, [scannedCards, fetchCard]);

  const handleAdd = async (tempId) => {
    const card = scannedCards.find(c => c.tempId === tempId);
    if (card && card.status === 'loaded') {
       if (committingRef.current.has(tempId)) return;
       committingRef.current.add(tempId);
       try {
           // Commit the primary printing plus any extra printings the user added on this card.
           // Each printing's language comes from the picked set (its flag), so there's no separate
           // language field to track.
           const primary = {
               quantity: card.quantity || 1,
               selectedSet: card.selectedSet,
               isManualEntry: card.isManualEntry,
               manualSetCode: card.manualSetCode,
               manualRarity: card.manualRarity,
           };
           const printings = [primary, ...(card.extraPrintings || [])];

           const buildCardData = (p, isPrimary) => {
               const cardData = { ...card.data, quantity: p.quantity || 1 };
               if (p.isManualEntry) {
                   cardData.set_code = p.manualSetCode || 'Unknown';
                   cardData.rarity = p.manualRarity || 'Unknown';
                   cardData.price = 0;
                   cardData.language = 'DE'; // manual codes are German-first
               } else if (p.selectedSet) {
                   cardData.set_code = p.selectedSet.set_code;
                   cardData.rarity = p.selectedSet.set_rarity;
                   // Yugipedia/Konami sets have no price -> 0 (the API fallback fills it from card_prices).
                   cardData.price = parseFloat(p.selectedSet.set_price) || 0;
                   cardData.language = p.selectedSet.language || 'DE';
               } else if (isPrimary && card.data.card_sets && card.data.card_sets.length > 0) {
                   const first = card.data.card_sets[0];
                   cardData.set_code = first.set_code;
                   cardData.rarity = first.set_rarity;
                   cardData.price = parseFloat(first.set_price) || 0;
                   cardData.language = 'EN';
               } else {
                   return null; // an extra line with nothing picked — skip it rather than guess a wrong code
               }
               return cardData;
           };

           if (window.api) {
                for (let i = 0; i < printings.length; i++) {
                    const data = buildCardData(printings[i], i === 0);
                    if (!data) continue;
                    const result = await window.api.addCardToDb(data);
                    if (!result.success) {
                        alert("Failed to save: " + result.error);
                        return; // keep the card in staging so nothing is silently lost
                    }
                }
           }
           setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
       } finally {
           committingRef.current.delete(tempId);
       }
    }
  };

  // Enter commits the topmost loaded card (bulk scanning without the mouse).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const top = scannedCards.find(c => c.status === 'loaded');
      if (top) { e.preventDefault(); handleAdd(top.tempId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedCards]);

  const handleDiscard = (tempId) => {
      setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
  };

  const handleClearAll = () => {
      if (confirm("Clear all scanned cards? This cannot be undone.")) {
          setScannedCards([]);
      }
  };

  const handleUpdateCard = (tempId, updates) => {
      setScannedCards(prev => prev.map(c => {
          if (c.tempId === tempId) {
              return { ...c, ...updates };
          }
          return c;
      }));
  };

  // Extra printings: let the user record several printings of the SAME scanned card (e.g. 2× the
  // German one + 1× the English) right here, instead of re-adding them from the collection later.
  // The user picks each printing (incl. its language) from the one flagged dropdown.
  const addPrinting = (tempId) => {
      setScannedCards(prev => prev.map(c => {
          if (c.tempId !== tempId) return c;
          const printing = { id: `${Date.now()}-${Math.random()}`, quantity: 1, selectedSet: null };
          return { ...c, extraPrintings: [...(c.extraPrintings || []), printing] };
      }));
  };

  const updatePrinting = (tempId, pid, updates) => {
      setScannedCards(prev => prev.map(c => c.tempId === tempId
          ? { ...c, extraPrintings: (c.extraPrintings || []).map(p => p.id === pid ? { ...p, ...updates } : p) }
          : c));
  };

  const removePrinting = (tempId, pid) => {
      setScannedCards(prev => prev.map(c => c.tempId === tempId
          ? { ...c, extraPrintings: (c.extraPrintings || []).filter(p => p.id !== pid) }
          : c));
  };

  const handleImportCsv = async () => {
    if (window.api) {
        try {
            const result = await window.api.importCsv();
            if (result && !result.canceled && result.cards) {
                // Add to staging (append so the list stays oldest-first)
                setScannedCards(prev => [
                    ...prev,
                    ...result.cards.map(c => ({
                        tempId: Date.now() + Math.random(), // Unique temp ID
                        passcode: c.passcode,
                        status: 'pending',
                        data: null,
                        language: 'DE' // Default to DE for imports
                    }))
                ]);
            }
        } catch (error) {
            console.error(error);
            alert("Error importing CSV");
        }
    } else {
        alert("CSV Import is only available in the desktop app.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-space-white flex items-center">
                Incoming Scans
                <span className="ml-3 text-sm font-normal text-gray-500 bg-gray-900 px-2 py-1 rounded-full">{scannedCards.length}</span>
            </h2>
            <div className="flex space-x-2">
                {scannedCards.length > 0 && (
                    <button
                        onClick={handleClearAll}
                        className="flex items-center px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 rounded-lg transition-colors text-sm border border-red-500/30"
                    >
                        <X className="w-4 h-4 mr-2" />
                        Clear All
                    </button>
                )}
                {scannedCards.some(c => c.status === 'loaded' && c.setMatchConfidence === 'exact') && (
                     <button
                        onClick={() => {
                            scannedCards
                                .filter(c => c.status === 'loaded' && c.setMatchConfidence === 'exact')
                                .forEach(c => handleAdd(c.tempId));
                        }}
                        disabled={isUpdating}
                        className="flex items-center px-4 py-2 bg-good/20 hover:bg-good/30 text-good rounded-lg transition-colors text-sm border border-good/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Add All Detected
                    </button>
                )}
                {scannedCards.some(c => c.status === 'loaded') && (
                     <button
                        onClick={() => {
                            const loadedCards = scannedCards.filter(c => c.status === 'loaded');
                            loadedCards.forEach(c => handleAdd(c.tempId));
                        }}
                        disabled={isUpdating}
                        className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors text-sm shadow-[0_0_10px_rgba(157,0,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Add All
                    </button>
                )}
                <button
                    onClick={handleImportCsv}
                    className="flex items-center px-4 py-2 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-white rounded-lg transition-colors text-sm border border-gray-700"
                >
                    <FileSpreadsheet className="w-4 h-4 mr-2 text-green-400" />
                    Import CSV
                </button>
                <button
                    onClick={() => setShowRarityGuide(true)}
                    className="flex items-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors text-sm border border-gray-700"
                >
                    <HelpCircle className="w-4 h-4 mr-2" />
                    Guide
                </button>
                <button
                    onClick={() => setShowSearch(true)}
                    className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors text-sm shadow-[0_0_10px_rgba(157,0,255,0.3)] hover:shadow-[0_0_20px_rgba(157,0,255,0.5)]"
                >
                    <Search className="w-4 h-4 mr-2" />
                    Search
                </button>
            </div>
        </div>

        {showRarityGuide && (
            <RarityGuide onClose={() => setShowRarityGuide(false)} />
        )}

        {showSearch && (
            <CardSearchModal
                onClose={() => setShowSearch(false)}
                onSelect={(card) => {
                   setScannedCards(prev => [...prev, {
                       tempId: Date.now() + Math.random(),
                       passcode: String(card.id),
                       status: 'pending',
                       data: null,
                       language: 'DE'
                   }]);
                   setShowSearch(false);
                }}
            />
        )}

        {scannedCards.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl bg-gray-900/50">
                <p className="text-lg font-medium">Ready to Scan</p>
                <p className="text-sm mt-2 opacity-60">Scanned cards from the app will appear here.</p>
            </div>
        )}

        <div className="grid grid-cols-1 gap-3">
            {scannedCards.map(card => (
                <div key={card.tempId} className="bg-[#1E1E1E] p-3 rounded-xl border border-gray-800 flex items-center shadow-lg hover:border-gray-700 transition-colors">
                    {/* Status / Image */}
                    <div className="w-12 h-16 sm:w-16 sm:h-20 bg-black rounded flex-shrink-0 border border-gray-700 overflow-hidden flex items-center justify-center mr-4 relative">
                        {card.status === 'loading' && <Loader2 className="animate-spin text-space-violet w-6 h-6" />}
                        {card.status === 'error' && <AlertCircle className="text-red-500 w-6 h-6" />}
                        {card.status === 'loaded' && card.data?.card_images?.[0]?.image_url && (
                             <img src={card.data.card_images[0].image_url_small || card.data.card_images[0].image_url} alt="Card" className="w-full h-full object-cover" />
                        )}
                        {card.status === 'pending' && <span className="text-xs text-gray-600">...</span>}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        {card.status === 'loading' && <div className="h-5 w-40 bg-gray-800 rounded animate-pulse mb-2"></div>}
                        {card.status === 'loaded' ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-lg text-space-white truncate">{card.data.name}</h3>
                                    {card.quantity > 1 && (
                                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-bold uppercase rounded border border-green-500/30">
                                            x{card.quantity}
                                        </span>
                                    )}
                                    {card.inCollection && (
                                        <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-500 text-[10px] font-bold uppercase rounded border border-yellow-500/30">
                                            Owned: x{card.ownedQuantity}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center text-xs space-x-2 mt-0.5 mb-2">
                                    <span className="text-space-violet font-mono bg-purple-900/30 px-1.5 py-0.5 rounded">{card.passcode}</span>
                                    <span className="text-gray-400 truncate">{card.data.type}</span>
                                </div>

                                <div className="flex gap-2 items-center">
                                    {/* Quantity */}
                                    <div className="flex items-center bg-black/40 rounded-lg border border-gray-700 p-0.5 h-8">
                                        <button
                                            onClick={() => handleUpdateCard(card.tempId, { quantity: Math.max(1, (card.quantity || 1) - 1) })}
                                            className="p-1 hover:bg-gray-700 rounded text-gray-400"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="w-6 text-center text-xs font-mono">{card.quantity || 1}</span>
                                        <button
                                            onClick={() => handleUpdateCard(card.tempId, { quantity: (card.quantity || 1) + 1 })}
                                            className="p-1 hover:bg-gray-700 rounded text-gray-400"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>

                                    {/* Printing (set code) — one flagged dropdown, no separate language selector */}
                                    <div className="flex-1 flex gap-2">
                                        {card.isManualEntry ? (
                                            <div className="flex gap-2 flex-1 animate-in fade-in zoom-in duration-200">
                                                <input
                                                    type="text"
                                                    placeholder="Set Code"
                                                    className="w-1/2 bg-black/40 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-space-violet outline-none"
                                                    value={card.manualSetCode || ''}
                                                    onChange={(e) => handleUpdateCard(card.tempId, { manualSetCode: e.target.value })}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Rarity"
                                                    className="w-1/2 bg-black/40 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-space-violet outline-none"
                                                    value={card.manualRarity || ''}
                                                    onChange={(e) => handleUpdateCard(card.tempId, { manualRarity: e.target.value })}
                                                />
                                            </div>
                                        ) : (
                                            <PrintingPicker
                                                printings={card.allPrintings}
                                                selectedSet={card.selectedSet}
                                                onSelect={(s) => handleUpdateCard(card.tempId, { selectedSet: s, setTouched: true })}
                                                loading={card.loadingSets}
                                            />
                                        )}

                                        {card.setMatchConfidence === 'exact' && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-good bg-good/10 border border-good/30 rounded px-1.5 py-1" title="Set code read from the card">
                                                Erkannt
                                            </span>
                                        )}
                                        {card.setMatchConfidence === 'fuzzy' && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded px-1.5 py-1" title="Set code recovered from an imperfect scan — please verify">
                                                Prüfen?
                                            </span>
                                        )}

                                        <button
                                            onClick={() => handleUpdateCard(card.tempId, { isManualEntry: !card.isManualEntry })}
                                            className={`p-1.5 rounded transition-colors ${card.isManualEntry ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                                            title="Toggle Manual Entry"
                                        >
                                            <Edit className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>

                                    {/* Extra printings of the same card (e.g. you also have the English print) */}
                                    {(card.extraPrintings || []).map((p) => (
                                        <div key={p.id} className="flex gap-2 items-center mt-2">
                                            <div className="flex items-center bg-black/40 rounded-lg border border-gray-700 p-0.5 h-8">
                                                <button onClick={() => updatePrinting(card.tempId, p.id, { quantity: Math.max(1, (p.quantity || 1) - 1) })} className="p-1 hover:bg-gray-700 rounded text-gray-400"><Minus className="w-3 h-3" /></button>
                                                <span className="w-6 text-center text-xs font-mono">{p.quantity || 1}</span>
                                                <button onClick={() => updatePrinting(card.tempId, p.id, { quantity: (p.quantity || 1) + 1 })} className="p-1 hover:bg-gray-700 rounded text-gray-400"><Plus className="w-3 h-3" /></button>
                                            </div>
                                            <PrintingPicker
                                                printings={card.allPrintings}
                                                selectedSet={p.selectedSet}
                                                onSelect={(s) => updatePrinting(card.tempId, p.id, { selectedSet: s })}
                                                loading={card.loadingSets}
                                            />
                                            <button onClick={() => removePrinting(card.tempId, p.id)} className="p-1.5 rounded bg-gray-800 text-gray-400 hover:text-red-400 transition-colors" title="Druckvariante entfernen">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => addPrinting(card.tempId)}
                                        className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-space-violet transition-colors"
                                        title="Weitere Druckvariante dieser Karte hinzufügen"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Weitere Druckvariante
                                    </button>
                            </>
                        ) : (
                             <p className="text-space-white font-mono">{card.passcode}</p>
                        )}
                        {card.status === 'error' && <p className="text-red-400 text-sm">Failed to fetch details.</p>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 ml-4">
                        <button
                            onClick={() => handleDiscard(card.tempId)}
                            className="p-2 rounded-full hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                            title="Discard"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        {card.status === 'loaded' && (
                             <button
                                onClick={() => handleAdd(card.tempId)}
                                disabled={isUpdating}
                                className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors font-medium text-sm shadow-[0_0_15px_rgba(157,0,255,0.3)] hover:shadow-[0_0_20px_rgba(157,0,255,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
                             >
                                <Check className="w-4 h-4 mr-2" />
                                Add
                             </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    </div>
  );
}
