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
          // Same sources as the phone: German printings from Yugipedia, English/international
          // from YGOPRODeck (YGOPRODeck has no -DE- set codes). German first, deduped by code+rarity.
          Promise.all([
              window.api.fetchYugipediaSets(card.id).then(s => s || []).catch(() => []),
              window.api.fetchCardData(card.id).then(d => (d && d.card_sets) || []).catch(() => []),
          ]).then(([deSets, enSets]) => {
              const tagged = [
                  ...deSets.map(s => ({ ...s, language: 'DE' })),
                  ...enSets.map(s => ({ ...s, language: 'EN' })),
              ];
              const seen = new Set();
              const merged = [];
              for (const s of tagged) {
                  const key = `${s.set_code}|${s.set_rarity}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  merged.push(s);
              }
              setAvailableSets(merged);
          });
      }
  }, [card]);

  if (!card) return null;

  const removeVariantLocal = (variant) => {
      setLocalVariants(prev => prev.filter(v =>
          !(v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
      ));
  };

  const handleDeleteVariant = async (variant) => {
      const result = await window.api.deleteCard({
          id: card.id,
          set_code: variant.set_code,
          language: variant.language || 'DE'
      });
      if (result.success) removeVariantLocal(variant);
  };

  const handleUpdateQuantity = async (variant, delta) => {
      const newQty = (variant.quantity || 0) + delta;
      if (newQty < 0) return;
      if (newQty === 0) { await handleDeleteVariant(variant); return; }

      const result = await window.api.updateCardMeta({
          id: card.id,
          set_code: variant.set_code,
          rarity: variant.rarity,
          quantity: newQty,
          language: variant.language || 'DE',
          price: variant.price
      });

      if (result.success) {
           setLocalVariants(prev => prev.map(v =>
               (v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
               ? { ...v, quantity: newQty }
               : v
           ));
      }
  };

  const handleAddVariant = async () => {
      if (!selectedNewSet) return;

      setIsAdding(true);

      let setInfo;
      try {
          setInfo = availableSets.find(s => `${s.set_code}|${s.set_rarity}` === selectedNewSet);
          if (!setInfo) throw new Error("Set not found");
      } catch (e) {
          console.error("Failed to parse selected set", e);
          setIsAdding(false);
          return;
      }

      const newVariant = {
          ...card,
          set_code: setInfo.set_code,
          rarity: setInfo.set_rarity,
          price: (parseFloat(setInfo.set_price) || 0),
          language: setInfo.language || 'DE',
          quantity: 1
      };

      const result = await window.api.addCardToDb(newVariant);

      if (result.success) {
          const existingIndex = localVariants.findIndex(v => v.set_code === newVariant.set_code && v.rarity === newVariant.rarity);
          if (existingIndex >= 0) {
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

  const isLink = card.type && card.type.includes('Link');
  const isXYZ = card.type && card.type.includes('XYZ');
  const levelLabel = isLink ? 'Link Rating' : (isXYZ ? 'Rank' : 'Level');

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
            <div className="bg-[#2a2a2a] p-4 rounded-xl border border-gray-700 mb-6 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold uppercase text-gray-400">Inventory Variants</span>
                    <span className="text-xs text-gray-500">Total Owned: {localVariants.reduce((sum, v) => sum + v.quantity, 0)}</span>
                </div>

                <div className="space-y-3 mb-4">
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
                                <button
                                    onClick={() => { if (confirm(`Delete ${variant.set_code} (${variant.rarity})?`)) handleDeleteVariant(variant); }}
                                    className="p-1.5 bg-crit/10 hover:bg-crit/20 text-crit rounded transition-colors"
                                    title="Delete this printing"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
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
                                options={(() => {
                                    // Deduplicate sets based on set_code + rarity
                                    const unique = new Map();
                                    availableSets.forEach(s => {
                                        const key = `${s.set_code}|${s.set_rarity}`;
                                        if (!unique.has(key)) unique.set(key, s);
                                    });

                                    return Array.from(unique.values())
                                        .filter(s => !localVariants.some(v => v.set_code === s.set_code && v.rarity === s.set_rarity))
                                        .map(set => ({
                                            value: `${set.set_code}|${set.set_rarity}`,
                                            label: `[${set.language}] ${set.set_code} - ${set.set_rarity}${set.set_price ? ` ($${set.set_price})` : ''}`
                                        }));
                                })()}
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
                {/* Level / Rank / Link Rating */}
                {card.level != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">{levelLabel}</span>
                        <span className="text-xl font-bold text-yellow-500">{isLink ? `LINK-${card.level}` : `★ ${card.level}`}</span>
                    </div>
                )}

                {/* ATK */}
                {card.atk != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">ATK</span>
                        <span className="text-xl font-bold text-red-400">{card.atk}</span>
                    </div>
                )}

                 {/* DEF (Hide if Link) */}
                 {!isLink && card.def != null && (
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

            <div className="prose prose-invert max-w-none flex-shrink-0">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Description</h3>
                <p className="text-gray-400 leading-relaxed whitespace-pre-wrap font-serif text-lg bg-black/20 p-4 rounded-lg border border-gray-800 max-h-[200px] overflow-y-auto custom-scrollbar">
                    {card.desc}
                </p>
            </div>
        </div>
      </div>
    </div>
  );
}
