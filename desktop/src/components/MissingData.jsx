import { useState, useEffect } from 'react';
import { AlertCircle, Edit2 } from 'lucide-react';
import CardDetailModal from './CardDetailModal';

export default function MissingData() {
  const [cards, setCards] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);

  useEffect(() => {
      const loadMissing = async () => {
          if (window.api) {
              const allCards = await window.api.getCollection();
              // Filter for cards with missing critical data
          // Ignore stats for Spell/Trap
          const missing = allCards.filter(c => {
              const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
              if (isMonster) {
                  return c.atk === null || c.def === null || c.level === null;
              }
              // For spells/traps, check if other critical info is missing (e.g. image)
              return !c.image_url;
          });
              setCards(missing);
          }
      };
      loadMissing();
  }, [selectedCard]); // Reload when card editing closes

  const handleEditClose = () => {
      setSelectedCard(null);
      // loadMissing is called by useEffect dependency on selectedCard
  };

  return (
    <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-space-white mb-6 flex items-center">
            <AlertCircle className="w-6 h-6 mr-3 text-yellow-500" />
            Missing Details
            <span className="ml-3 text-sm font-normal text-gray-500 bg-gray-900 px-2 py-1 rounded-full">{cards.length}</span>
        </h2>

        {cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl bg-gray-900/50">
                <p className="text-lg font-medium">All Clear!</p>
                <p className="text-sm mt-2 opacity-60">No cards with missing details found.</p>
            </div>
        ) : (
            <div className="bg-[#1E1E1E] rounded-xl border border-gray-800 overflow-hidden">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-black/50 text-xs uppercase text-gray-500">
                        <tr>
                            <th className="px-6 py-4 font-medium">Card</th>
                            <th className="px-6 py-4 font-medium">Missing</th>
                            <th className="px-6 py-4 font-medium text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {cards.map(card => {
                            const missingFields = [];
                            const isMonster = card.type && !card.type.includes('Spell') && !card.type.includes('Trap');

                            if (isMonster && (card.atk == null || card.def == null)) missingFields.push('Stats');
                            if (!card.image_url) missingFields.push('Image');

                            return (
                                <tr key={`${card.id}-${card.set_code}`} className="hover:bg-gray-800/50 transition-colors">
                                    <td className="px-6 py-4 text-white font-medium flex items-center gap-3">
                                        <div className="w-8 h-12 bg-black rounded overflow-hidden flex-shrink-0">
                                            <img src={card.image_url} className="w-full h-full object-cover" alt="" />
                                        </div>
                                        <div>
                                            <div>{card.name}</div>
                                            <div className="text-xs text-gray-500 font-mono">{card.id}</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            {missingFields.map(f => (
                                                <span key={f} className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded border border-red-500/30">
                                                    {f}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => setSelectedCard(card)}
                                            className="flex items-center ml-auto px-3 py-1.5 bg-gray-800 hover:bg-space-violet text-gray-400 hover:text-white rounded-lg transition-colors text-xs border border-gray-700"
                                        >
                                            <Edit2 className="w-3 h-3 mr-2" />
                                            Edit
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        )}

        {selectedCard && (
            <CardDetailModal card={selectedCard} onClose={handleEditClose} />
        )}
    </div>
  );
}
