import { useEffect, useCallback, useState } from 'react';
import { Check, X, Loader2, AlertCircle, FileSpreadsheet, Minus, Plus, HelpCircle, Edit, Globe } from 'lucide-react';
import { playScanSound } from '../utils/sound';
import CustomSelect from './CustomSelect';
import RarityGuide from './RarityGuide';
import CardSearchModal from './CardSearchModal';
import { Search } from 'lucide-react';

export default function StagingArea({ scannedCards, setScannedCards, isUpdating }) {
  const [showRarityGuide, setShowRarityGuide] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const fetchCard = useCallback(async (tempId, passcode) => {
    // Set loading immediately to prevent double fetch
    setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, status: 'loading' } : c));

    if (window.api) {
        try {
            const data = await window.api.fetchCardData(passcode);
            if (data && !data.error) {
                // Check if already in DB
                const result = await window.api.checkCardExists(passcode);

                // Determine Language & Sets
                let defaultLang = 'DE'; // User preference: >99% German
                let germanSets = [];
                let preSelectedSet = null;

                // If defaultLang is DE, try fetching Yugipedia sets
                if (defaultLang === 'DE') {
                    try {
                        const yugipediaSets = await window.api.fetchYugipediaSets(passcode);
                        if (yugipediaSets && yugipediaSets.length > 0) {
                            germanSets = yugipediaSets;
                            // Default to first set if available
                            preSelectedSet = { ...germanSets[0], isYugipedia: true };
                        }
                    } catch (e) { console.error(e); }
                }

                setScannedCards(prev => prev.map(c => c.tempId === tempId ? {
                    ...c,
                    status: 'loaded',
                    data,
                    germanSets,
                    inCollection: result.exists,
                    ownedQuantity: result.quantity,
                    language: defaultLang,
                    selectedSet: preSelectedSet || (data.card_sets ? data.card_sets[0] : null)
                } : c));
                playScanSound();
            } else {
                setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
            }
        } catch (e) {
             setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
        }
    } else {
        // Mock
        setTimeout(() => {
             setScannedCards(prev => prev.map(c => c.tempId === tempId ? {
                 ...c,
                 status: 'loaded',
                 data: { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', race: 'Dragon', card_images: [{ image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }] },
                 language: 'DE'
             } : c));
        }, 1000);
    }
  }, [setScannedCards]);

  useEffect(() => {
    scannedCards.forEach(card => {
      if (card.status === 'pending') {
        fetchCard(card.tempId, card.passcode);
      }
    });
  }, [scannedCards, fetchCard]);

  const handleAdd = async (tempId) => {
    const card = scannedCards.find(c => c.tempId === tempId);
    if (card && card.status === 'loaded') {
       // Prepare data
       const cardData = {
           ...card.data,
           quantity: card.quantity || 1,
           language: card.language || 'DE'
       };

       if (card.isManualEntry) {
           cardData.set_code = card.manualSetCode || 'Unknown';
           cardData.rarity = card.manualRarity || 'Unknown';
           cardData.price = 0;
       } else if (card.selectedSet) {
           cardData.set_code = card.selectedSet.set_code;
           cardData.rarity = card.selectedSet.set_rarity;
           // If it's a Yugipedia set, it has no price, so we rely on 0 (fallback to generic) or we should map it?
           // The API fallback logic handles 0 prices by checking card_prices.
           cardData.price = parseFloat(card.selectedSet.set_price) || 0;
       } else if (card.data.card_sets && card.data.card_sets.length > 0) {
           // Default to first set if not selected
           const first = card.data.card_sets[0];
           cardData.set_code = first.set_code;
           cardData.rarity = first.set_rarity;
           cardData.price = parseFloat(first.set_price) || 0;
       }

       if (window.api) {
            const result = await window.api.addCardToDb(cardData);
            if (result.success) {
                setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
            } else {
                alert("Failed to save: " + result.error);
            }
       } else {
            setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
       }
    }
  };

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

  const handleImportCsv = async () => {
    if (window.api) {
        try {
            const result = await window.api.importCsv();
            if (result && !result.canceled && result.cards) {
                // Add to staging
                setScannedCards(prev => [
                    ...result.cards.map(c => ({
                        tempId: Date.now() + Math.random(), // Unique temp ID
                        passcode: c.passcode,
                        status: 'pending',
                        data: null,
                        language: 'DE' // Default to DE for imports
                    })),
                    ...prev
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
                   setScannedCards(prev => [{
                       tempId: Date.now() + Math.random(),
                       passcode: String(card.id),
                       status: 'pending',
                       data: null,
                       language: 'DE'
                   }, ...prev]);
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

                                    {/* Language Selector */}
                                    <div className="flex items-center bg-black/40 rounded-lg border border-gray-700 p-0.5 h-8 px-2">
                                        <Globe className="w-3 h-3 text-gray-400 mr-2" />
                                        <select
                                            value={card.language || 'DE'}
                                            onChange={(e) => handleUpdateCard(card.tempId, { language: e.target.value })}
                                            className="bg-transparent text-xs text-white outline-none cursor-pointer"
                                        >
                                            <option value="DE">German (DE)</option>
                                            <option value="EN">English (EN)</option>
                                            <option value="JP">Japanese (JP)</option>
                                        </select>
                                    </div>

                                    {/* Rarity/Set Selection */}
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
                                            (card.language === 'DE' && card.germanSets && card.germanSets.length > 0) ? (
                                                // Yugipedia German Sets Dropdown
                                                <div className="flex-1">
                                                    <CustomSelect
                                                        value={card.selectedSet ? `${card.selectedSet.set_code}|${card.selectedSet.set_rarity}` : ''}
                                                        onChange={(val) => {
                                                            const [code, rarity] = val.split('|');
                                                            const selected = card.germanSets.find(s => s.set_code === code && s.set_rarity === rarity);
                                                            handleUpdateCard(card.tempId, { selectedSet: { ...selected, isYugipedia: true } });
                                                        }}
                                                        placeholder="Select German Rarity"
                                                        options={card.germanSets.map(set => ({
                                                            value: `${set.set_code}|${set.set_rarity}`,
                                                            label: `${set.set_code} - ${set.set_rarity}`
                                                        }))}
                                                        className="w-full"
                                                    />
                                                </div>
                                            ) : (
                                                // Fallback English/Localized API Sets
                                                card.data.card_sets ? (
                                                    <div className="flex-1">
                                                        <CustomSelect
                                                            value={card.selectedSet ? `${card.selectedSet.set_code}|${card.selectedSet.set_rarity}` : ''}
                                                            onChange={(val) => {
                                                                const [code, rarity] = val.split('|');
                                                                const selected = card.data.card_sets.find(s => s.set_code === code && s.set_rarity === rarity);
                                                                handleUpdateCard(card.tempId, { selectedSet: selected });
                                                            }}
                                                            placeholder={card.data.card_sets[0] ? `${card.data.card_sets[0].set_code} - ${card.data.card_sets[0].set_rarity}` : "Select Rarity"}
                                                            options={(() => {
                                                                const unique = new Map();
                                                                card.data.card_sets.forEach(s => {
                                                                    const key = `${s.set_code}|${s.set_rarity}`;
                                                                    if (!unique.has(key)) unique.set(key, s);
                                                                });
                                                                return Array.from(unique.values()).map(set => ({
                                                                    value: `${set.set_code}|${set.set_rarity}`,
                                                                    label: `${set.set_code} - ${set.set_rarity} ($${set.set_price || '0.00'})`
                                                                }));
                                                            })()}
                                                            className="w-full"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="flex-1 bg-gray-800 rounded px-2 py-1 text-xs text-yellow-500 border border-yellow-500/30 flex items-center justify-center">
                                                        <AlertCircle className="w-3 h-3 mr-1" />
                                                        No sets found via API
                                                    </div>
                                                )
                                            )
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
