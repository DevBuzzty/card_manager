import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

export default function CollectionList() {
  const [cards, setCards] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const loadCollection = async () => {
        if (window.api) {
          const result = await window.api.getCollection();
          setCards(result);
        } else {
            // Mock
            setCards([
                { id: '46986414', name: 'Dark Magician', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg' },
                { id: '89631139', name: 'Blue-Eyes White Dragon', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }
            ]);
        }
    };
    loadCollection();
  }, []);

  const filteredCards = cards.filter(c =>
    (c.name && c.name.toLowerCase().includes(filter.toLowerCase())) ||
    (c.id && String(c.id).includes(filter))
  );

  return (
    <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-space-white">My Collection</h2>
            <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-space-violet transition-colors" />
                <input
                    type="text"
                    placeholder="Search cards..."
                    className="bg-[#1a1a1a] border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-space-violet w-64 transition-all"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
            </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
            {filteredCards.map(card => (
                <div key={card.id} className="group relative bg-[#1E1E1E] rounded-xl overflow-hidden shadow-black shadow-lg hover:shadow-[0_0_20px_rgba(157,0,255,0.2)] transition-all duration-300 hover:-translate-y-1 border border-gray-800 hover:border-space-violet/50">
                    <div className="aspect-[246/357] overflow-hidden relative">
                        {/* Placeholder or Image */}
                        <div className="absolute inset-0 bg-gray-800 animate-pulse"></div>
                        <img
                            src={card.image_url}
                            alt={card.name}
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                            onLoad={(e) => e.target.previousSibling && (e.target.previousSibling.style.display = 'none')}
                        />
                    </div>
                    {/* Overlay info always visible on mobile, hover on desktop? No, let's keep it simple. */}
                    <div className="p-3">
                         <h3 className="font-bold text-gray-200 text-sm leading-tight truncate" title={card.name}>{card.name}</h3>
                         <p className="text-[10px] text-gray-500 font-mono mt-1">{card.id}</p>
                    </div>
                </div>
            ))}
        </div>

        {filteredCards.length === 0 && (
            <div className="text-center py-20 text-gray-600">
                <p>No cards found.</p>
            </div>
        )}
    </div>
  );
}
