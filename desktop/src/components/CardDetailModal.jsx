import { X, Minus, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';

export default function CardDetailModal({ card, onClose }) {
  const [quantity, setQuantity] = useState(card ? card.quantity || 1 : 1);
  const [selectedSetCode, setSelectedSetCode] = useState(card ? card.set_code || '' : '');
  const [cardSets, setCardSets] = useState([]);

  useEffect(() => {
      if (!card) return;
      // Fetch full card data (sets) if missing, using API via main process ideally
      // But since we store most data, we might need to fetch `card_sets` freshly if not stored in DB deeply enough
      // For now, let's assume `card.card_sets` might be available if we stored the full object or we fetch it now.
      // We'll use a simple fetch here or IPC if we want to be strict.
      // Let's use the existing fetchCardData IPC for consistency to get sets.
      if (window.api) {
          window.api.fetchCardData(card.id).then(data => {
              if (data && data.card_sets) {
                  setCardSets(data.card_sets);
              }
          });
      }
  }, [card]);

  if (!card) return null;

  const handleUpdate = async (newQty, newSetCode) => {
      // Optimistic update
      if (newQty < 1) newQty = 1; // Minimum 1 for now? Or allow 0 to delete? Let's say 1. 0 should be a delete button logic.

      setQuantity(newQty);
      setSelectedSetCode(newSetCode);

      // Find price for new set
      let newPrice = card.price;
      const setInfo = cardSets.find(s => s.set_code === newSetCode);
      if (setInfo) {
          newPrice = parseFloat(setInfo.set_price) || 0;
      }

      if (window.api) {
          await window.api.updateCardMeta({
              id: card.id,
              set_code: newSetCode, // Key for update if we treat (id, set_code) as PK, but we might be updating the *row*
              // Wait, if PK is (id, set_code), changing set_code is an INSERT/DELETE or complex update.
              // To simplify: we update the CURRENT row's quantity/set_code/rarity.
              // However, main.cjs `update-card-meta` needs to handle this.
              // Let's pass old_set_code to identify row if needed, or just update by ID if we assume 1 entry per ID for now (simplification).
              // Re-reading requirements: "update that one card".
              // We will send:
              passcode: card.id,
              old_set_code: card.set_code, // to identify which entry to update
              new_set_code: newSetCode,
              rarity: setInfo ? setInfo.set_rarity : (card.rarity || 'Unknown'),
              quantity: newQty,
              price: newPrice
          });
      }
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
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
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

            <div className="bg-[#2a2a2a] p-4 rounded-xl border border-gray-700 mb-6 space-y-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-bold uppercase text-gray-400">Inventory Management</span>
                </div>

                <div className="flex items-center gap-4">
                    {/* Quantity Control */}
                    <div className="flex items-center bg-black/40 rounded-lg border border-gray-600 p-1">
                        <button
                            onClick={() => handleUpdate(quantity - 1, selectedSetCode)}
                            className="p-2 hover:bg-gray-700 rounded text-gray-300 transition-colors"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-12 text-center font-mono font-bold text-lg">{quantity}</span>
                        <button
                            onClick={() => handleUpdate(quantity + 1, selectedSetCode)}
                            className="p-2 hover:bg-gray-700 rounded text-gray-300 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Rarity Selector */}
                    <div className="flex-1">
                        <CustomSelect
                            value={selectedSetCode}
                            onChange={(val) => handleUpdate(quantity, val)}
                            placeholder="Select Set / Rarity..."
                            options={cardSets.map(set => ({
                                value: set.set_code,
                                label: `${set.set_code} - ${set.set_rarity} ($${set.set_price})`
                            }))}
                        />
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
