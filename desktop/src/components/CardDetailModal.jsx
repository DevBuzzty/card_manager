import { X, Minus, Plus, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';

export default function CardDetailModal({ card, onClose }) {
  const [localVariants, setLocalVariants] = useState(card.variants || []);
  const [availableSets, setAvailableSets] = useState([]);
  const [selectedNewSet, setSelectedNewSet] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
      setLocalVariants(card.variants || []);
      if (window.api) {
          window.api.fetchCardData(card.id).then(data => {
              if (data && data.card_sets) {
                  setAvailableSets(data.card_sets);
              }
          });
      }
  }, [card]);

  if (!card) return null;

  const handleUpdateQuantity = async (variant, delta) => {
      const newQty = (variant.quantity || 0) + delta;
      if (newQty < 0) return; // Prevent negatives

      // If newQty is 0, we effectively delete it (or keep it as 0).
      // Let's keep it as 0 for now so user can add back, or maybe confirm delete.
      // For UX, if 0, maybe show trash icon or just 0.

      const result = await window.api.updateCardMeta({
          passcode: card.id,
          old_set_code: variant.set_code,
          new_set_code: variant.set_code,
          rarity: variant.rarity,
          quantity: newQty,
          price: variant.price
      });

      if (result.success) {
           setLocalVariants(prev => prev.map(v =>
               (v.set_code === variant.set_code) ? { ...v, quantity: newQty } : v
           ));
      }
  };

  const handleAddVariant = async () => {
      if (!selectedNewSet) return;

      setIsAdding(true);
      const setInfo = availableSets.find(s => s.set_code === selectedNewSet);

      // Default to "Unknown" stats if not found (shouldn't happen if selected from list)
      const newVariant = {
          ...card, // Inherit base stats
          set_code: setInfo ? setInfo.set_code : selectedNewSet,
          rarity: setInfo ? setInfo.set_rarity : 'Unknown',
          price: setInfo ? (parseFloat(setInfo.set_price) || 0) : 0,
          quantity: 1
      };

      const result = await window.api.addCardToDb(newVariant);

      if (result.success) {
          // Update local state
          const existingIndex = localVariants.findIndex(v => v.set_code === newVariant.set_code);
          if (existingIndex >= 0) {
              // Should have updated quantity in backend, update frontend
              setLocalVariants(prev => prev.map((v, i) =>
                  i === existingIndex ? { ...v, quantity: v.quantity + 1 } : v
              ));
          } else {
              setLocalVariants(prev => [...prev, newVariant]);
          }
          setSelectedNewSet('');
      }
      setIsAdding(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-[#1E1E1E] w-full max-w-4xl max-h-[90vh] rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>

        {/* Left: Image */}
        <div className="w-full md:w-1/3 bg-black flex items-center justify-center p-6 border-b md:border-b-0 md:border-r border-gray-700">
           <img
             src={card.image_url}
             alt={card.name}
             className="max-w-full max-h-[60vh] object-contain shadow-[0_0_30px_rgba(157,0,255,0.2)] rounded-lg"
           />
        </div>

        {/* Right: Details */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar flex flex-col">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-3xl font-bold text-space-white mb-2">{card.name}</h2>
                    <div className="flex flex-wrap gap-2">
                        <span className="px-3 py-1 bg-space-violet/20 text-space-violet rounded-full text-sm font-medium border border-space-violet/30">
                            {card.type}
                        </span>
                        {card.race && (
                             <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm font-medium border border-gray-700">
                                {card.race}
                             </span>
                        )}
                        {card.attribute && (
                             <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm font-medium border border-gray-700 font-mono">
                                {card.attribute}
                             </span>
                        )}
                    </div>
                </div>
                <button onClick={onClose} className="p-2 bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                </button>
            </div>

            {/* Inventory / Variants Section */}
            <div className="bg-[#2a2a2a] p-4 rounded-xl border border-gray-700 mb-6 flex-grow overflow-auto">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold uppercase text-gray-400">Inventory Variants</span>
                    <span className="text-xs text-gray-500">Total Owned: {localVariants.reduce((sum, v) => sum + v.quantity, 0)}</span>
                </div>

                <div className="space-y-3 mb-4 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                    {localVariants.length === 0 && <p className="text-gray-500 text-sm italic">No variants owned.</p>}
                    {localVariants.map((variant, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-black/40 p-2 rounded-lg border border-gray-800">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-yellow-500 font-bold">{variant.set_code}</span>
                                    <span className="text-xs text-gray-400 border border-gray-700 px-1 rounded">{variant.rarity}</span>
                                </div>
                                <span className="text-xs text-space-violet">${(variant.price || 0).toFixed(2)}</span>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex items-center bg-[#1E1E1E] rounded border border-gray-600">
                                    <button
                                        onClick={() => handleUpdateQuantity(variant, -1)}
                                        className="p-1 hover:bg-gray-700 rounded-l text-gray-400 hover:text-white transition-colors"
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                    <span className="w-8 text-center font-mono text-sm font-bold">{variant.quantity}</span>
                                    <button
                                        onClick={() => handleUpdateQuantity(variant, 1)}
                                        className="p-1 hover:bg-gray-700 rounded-r text-gray-400 hover:text-white transition-colors"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Add New Variant */}
                <div className="pt-3 border-t border-gray-700">
                    <label className="text-xs text-gray-500 uppercase font-bold mb-2 block">Add Another Printing</label>
                    <div className="flex gap-2">
                         <div className="flex-1">
                            <CustomSelect
                                value={selectedNewSet}
                                onChange={setSelectedNewSet}
                                placeholder="Select Set..."
                                options={availableSets
                                    .filter(s => !localVariants.some(v => v.set_code === s.set_code)) // Filter out already owned? Optional. Let's keep all.
                                    .map(set => ({
                                        value: set.set_code,
                                        label: `${set.set_code} - ${set.set_rarity} ($${set.set_price})`
                                    }))}
                            />
                        </div>
                        <button
                            onClick={handleAddVariant}
                            disabled={!selectedNewSet || isAdding}
                            className="bg-space-violet hover:bg-violet-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isAdding ? 'Adding...' : 'Add'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
                {/* Level / Rank */}
                {card.level != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Level / Rank</span>
                        <span className="text-xl font-bold text-yellow-500">★ {card.level}</span>
                    </div>
                )}

                {/* ATK */}
                {card.atk != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">ATK</span>
                        <span className="text-xl font-bold text-red-400">{card.atk}</span>
                    </div>
                )}

                 {/* DEF */}
                 {card.def != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">DEF</span>
                        <span className="text-xl font-bold text-blue-400">{card.def}</span>
                    </div>
                )}

                 {/* Passcode */}
                <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                    <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Passcode</span>
                    <span className="text-xl font-mono text-gray-300">{card.id}</span>
                </div>
            </div>

            <div className="prose prose-invert max-w-none">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Description</h3>
                <p className="text-gray-400 leading-relaxed whitespace-pre-wrap font-serif text-lg bg-black/20 p-4 rounded-lg border border-gray-800">
                    {card.desc}
                </p>
            </div>
        </div>
      </div>
    </div>
  );
}
