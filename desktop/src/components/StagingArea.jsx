import { useEffect, useCallback } from 'react';
import { Check, X, Loader2, AlertCircle, FileSpreadsheet, Minus, Plus } from 'lucide-react';
import { playScanSound } from '../utils/sound';
import CustomSelect from './CustomSelect';

export default function StagingArea({ scannedCards, setScannedCards, isUpdating }) {

  const fetchCard = useCallback(async (tempId, passcode) => {
    // Set loading immediately to prevent double fetch
    setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, status: 'loading' } : c));

    if (window.api) {
        try {
            const data = await window.api.fetchCardData(passcode);
            if (data && !data.error) {
                // Check if already in DB
                const result = await window.api.checkCardExists(passcode);
                setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, status: 'loaded', data, inCollection: result.exists, ownedQuantity: result.quantity } : c));
                playScanSound(); // Play sound on successful fetch
            } else {
                // If not found or error, remove the card entirely
                setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
            }
        } catch (e) { // eslint-disable-line no-unused-vars
             // If error, remove the card entirely
             setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
        }
    } else {
        // Mock for browser dev without Electron
        setTimeout(() => {
             setScannedCards(prev => prev.map(c => c.tempId === tempId ? {
                 ...c,
                 status: 'loaded',
                 data: { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', race: 'Dragon', card_images: [{ image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }] }
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
       const cardData = { ...card.data, quantity: card.quantity || 1 };

       if (card.selectedSet) {
           cardData.set_code = card.selectedSet.set_code;
           cardData.rarity = card.selectedSet.set_rarity;
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
                        data: null
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
            </div>
        </div>

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

                                <div className="flex gap-2">
                                    {/* Quantity */}
                                    <div className="flex items-center bg-black/40 rounded-lg border border-gray-700 p-0.5">
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

                                    {/* Rarity */}
                                    {card.data.card_sets && (
                                        <div className="flex-1">
                                            <CustomSelect
                                                value={card.selectedSet?.set_code || ''}
                                                onChange={(val) => {
                                                    const selected = card.data.card_sets.find(s => s.set_code === val);
                                                    handleUpdateCard(card.tempId, { selectedSet: selected });
                                                }}
                                                placeholder={card.data.card_sets[0] ? `${card.data.card_sets[0].set_rarity} (Default)` : "Select Rarity"}
                                                options={card.data.card_sets.map(set => ({
                                                    value: set.set_code,
                                                    label: `${set.set_code} - ${set.set_rarity}`
                                                }))}
                                                className="w-full"
                                            />
                                        </div>
                                    )}
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
