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
              const missing = allCards.filter(c => {
                  const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
                  const isLink = c.type && c.type.includes('Link');

                  if (isMonster) {
                      // ATK is always required
                      if (c.atk === null) return true;

                      // DEF required unless Link
                      if (!isLink && c.def === null) return true;

                      // Level (or Rank/Link Rating) is required
                      // We now map Link Rating to 'level' in backend, so level should be present.
                      if (c.level === null) return true;

                      return false;
                  }

                  // For spells/traps, check if other critical info is missing (e.g. image)
                  return !c.image_url;
              });
              setCards(missing);
          } else {
              // Dev Mock
              const mockCards = [
                  { id: '1', name: 'Valid Link', type: 'Link Monster', atk: 1000, def: null, level: 2, image_url: 'http://foo' },
                  { id: '2', name: 'Valid Zero ATK', type: 'Normal Monster', atk: 0, def: 2000, level: 4, image_url: 'http://foo' },
                  { id: '3', name: 'Missing Image', type: 'Spell Card', image_url: '' },
                  { id: '4', name: 'Missing ATK', type: 'Normal Monster', atk: null, def: 1000, level: 4, image_url: 'http://foo' },
                  { id: '5', name: 'Missing Link Rating', type: 'Link Monster', atk: 1500, def: null, level: null, image_url: 'http://foo' },
              ];
               const missing = mockCards.filter(c => {
                  const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
                  const isLink = c.type && c.type.includes('Link');

                  if (isMonster) {
                      if (c.atk === null) return true;
                      if (!isLink && c.def === null) return true;
                      if (c.level === null) return true;
                      return false;
                  }
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
                            const isLink = card.type && card.type.includes('Link');

                            if (isMonster) {
                                if (card.atk == null) missingFields.push('ATK');
                                if (!isLink && card.def == null) missingFields.push('DEF');
                                if (card.level == null) missingFields.push(isLink ? 'Link Rating' : 'Level/Rank');
                            }
                            if (!card.image_url) missingFields.push('Image');

                            return (
                                <tr key={`${card.id}-${card.set_code}`} className="hover:bg-gray-800/50 transition-colors">
                                    <td className="px-6 py-4 text-white font-medium flex items-center gap-3">
                                        <div className="w-8 h-12 bg-black rounded overflow-hidden flex-shrink-0 relative">
                                            {card.image_url ? (
                                                <img src={card.image_url} className="w-full h-full object-cover" alt="" />
                                            ) : (
                                                <div className="w-full h-full bg-gray-800 flex items-center justify-center text-xs text-gray-600">?</div>
                                            )}
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
