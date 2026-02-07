import { useEffect, useState, useMemo } from 'react';
import { Search, RefreshCw, LayoutGrid, List as ListIcon, Database, FilterX } from 'lucide-react';
import CardDetailModal from './CardDetailModal';
import CustomSelect from './CustomSelect';

export default function CollectionList({ isUpdating, setUpdateProgress }) {
  const [rawCards, setRawCards] = useState([]);
  const [filter, setFilter] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [localUpdating, setLocalUpdating] = useState(false);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [sortType, setSortType] = useState('newest'); // 'newest', 'name', 'price', 'atk', 'def', 'level'

  // Filters
  const [filterType, setFilterType] = useState('All');
  const [filterAttribute, setFilterAttribute] = useState('All');
  const [filterRace, setFilterRace] = useState('All');
  const [filterSet, setFilterSet] = useState('All');

  const updating = isUpdating || localUpdating;

  const loadCollection = async () => {
    if (window.api) {
      const result = await window.api.getCollection();
      setRawCards(result);
    } else {
        // Mock
        setRawCards([
            { id: '46986414', name: 'Dark Magician', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg', atk: 2500, def: 2100, level: 7, race: 'Spellcaster', attribute: 'DARK', desc: 'The ultimate wizard...', quantity: 1, price: 5.50, set_code: 'LOB-005', rarity: 'Ultra Rare' },
            { id: '46986414', name: 'Dark Magician', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/46986414.jpg', atk: 2500, def: 2100, level: 7, race: 'Spellcaster', attribute: 'DARK', desc: 'The ultimate wizard...', quantity: 3, price: 1.20, set_code: 'SDY-006', rarity: 'Common' },
            { id: '89631139', name: 'Blue-Eyes White Dragon', type: 'Normal Monster', image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg', atk: 3000, def: 2500, level: 8, race: 'Dragon', attribute: 'LIGHT', desc: 'This legendary dragon...', quantity: 1, price: 50.00, set_code: 'LOB-001', rarity: 'Ultra Rare' }
        ]);
    }
  };

  useEffect(() => {
    loadCollection();
  }, [updating]);

  const handleUpdate = async (mode) => {
    if (!window.api || updating) return;

    const message = mode === 'all'
        ? "Update details for all cards? This might take a while."
        : "Fetch missing details for incomplete cards?";

    if (!confirm(message)) return;

    setLocalUpdating(true);
    setUpdateProgress({ current: 0, total: 0 });

    try {
        const result = mode === 'all'
            ? await window.api.updateAllCards()
            : await window.api.updateMissingCards();

        if (result.success) {
            alert(`Updated ${result.updatedCount} cards.`);
            loadCollection();
        } else {
            alert("Update failed: " + result.error);
        }
    } catch (e) {
        console.error(e);
        alert("Update failed.");
    } finally {
        setLocalUpdating(false);
        setUpdateProgress(null);
    }
  };

  // Group cards by ID
  const groupedCards = useMemo(() => {
      const groups = {};
      rawCards.forEach(card => {
          if (!groups[card.id]) {
              groups[card.id] = {
                  ...card, // Inherit base props
                  quantity: 0,
                  totalValue: 0,
                  variants: [],
                  // Keep highest price for sorting
                  maxPrice: 0,
                  // Keep latest created_at for sorting
                  newestDate: new Date(0),
                  // Aggregated sets
                  sets: new Set()
              };
          }
          const g = groups[card.id];
          g.quantity += (card.quantity || 1);
          g.totalValue += (card.price || 0) * (card.quantity || 1);
          g.variants.push(card);
          if (card.set_code) g.sets.add(card.set_code.split('-')[0]); // Add Set Code Prefix (e.g. LOB)

          if ((card.price || 0) > g.maxPrice) g.maxPrice = card.price || 0;

          const cDate = new Date(card.created_at);
          if (cDate > g.newestDate) g.newestDate = cDate;
      });
      return Object.values(groups);
  }, [rawCards]);

  // Extract available options for filters
  const { attributes, races, sets } = useMemo(() => {
      const attrs = new Set();
      const rcs = new Set();
      const sts = new Set();

      groupedCards.forEach(c => {
          if (c.attribute) attrs.add(c.attribute);
          if (c.race) rcs.add(c.race);
          c.sets.forEach(s => sts.add(s));
      });

      return {
          attributes: Array.from(attrs).sort().map(a => ({ value: a, label: a })),
          races: Array.from(rcs).sort().map(r => ({ value: r, label: r })),
          sets: Array.from(sts).sort().map(s => ({ value: s, label: s }))
      };
  }, [groupedCards]);

  const filteredAndSortedCards = useMemo(() => {
      return groupedCards.filter(c => {
        const matchesSearch = (c.name && c.name.toLowerCase().includes(filter.toLowerCase())) ||
                              (c.id && String(c.id).includes(filter));
        const matchesType = filterType === 'All' || (c.type && c.type.includes(filterType));
        const matchesAttribute = filterAttribute === 'All' || c.attribute === filterAttribute;
        const matchesRace = filterRace === 'All' || c.race === filterRace;
        const matchesSet = filterSet === 'All' || Array.from(c.sets).includes(filterSet);

        return matchesSearch && matchesType && matchesAttribute && matchesRace && matchesSet;
      }).sort((a, b) => {
          switch (sortType) {
              case 'name': return (a.name || '').localeCompare(b.name || '');
              case 'price': return b.maxPrice - a.maxPrice;
              case 'atk': return (b.atk || 0) - (a.atk || 0);
              case 'def': return (b.def || 0) - (a.def || 0);
              case 'level': return (b.level || 0) - (a.level || 0);
              case 'newest': return b.newestDate - a.newestDate;
              default: return 0;
          }
      });
  }, [groupedCards, filter, filterType, filterAttribute, filterRace, filterSet, sortType]);

  const clearFilters = () => {
      setFilter('');
      setFilterType('All');
      setFilterAttribute('All');
      setFilterRace('All');
      setFilterSet('All');
  };

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
        {/* Header / Controls */}
        <div className="flex flex-col gap-4 mb-4 bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 shrink-0">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-space-white">My Collection</h2>
                    <span className="text-gray-500 text-sm">({filteredAndSortedCards.length} Cards)</span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => handleUpdate('missing')}
                        disabled={updating}
                        className="flex items-center px-3 py-1.5 bg-gray-800 hover:bg-space-violet text-gray-400 hover:text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium border border-gray-700"
                        title="Fetch missing details only"
                    >
                        <Database className="w-3 h-3 mr-2" />
                        Fetch Missing
                    </button>
                    <button
                        onClick={() => handleUpdate('all')}
                        disabled={updating}
                        className="p-2 bg-gray-800 hover:bg-space-violet text-gray-400 hover:text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Update all card details from API"
                    >
                        <RefreshCw className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                 {/* View Toggles */}
                <div className="flex items-center bg-[#1a1a1a] rounded-lg border border-gray-800 p-1">
                     <button
                        onClick={() => setViewMode('grid')}
                        className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                        title="Grid View"
                     >
                         <LayoutGrid className="w-4 h-4" />
                     </button>
                     <button
                        onClick={() => setViewMode('list')}
                        className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                        title="List View"
                     >
                         <ListIcon className="w-4 h-4" />
                     </button>
                </div>

                {/* Search */}
                <div className="relative group flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-space-violet transition-colors" />
                    <input
                        type="text"
                        placeholder="Search cards..."
                        className="bg-[#1a1a1a] border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-space-violet w-full transition-all"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>

                <div className="h-6 w-px bg-gray-700 mx-1"></div>

                {/* Filters Row 1 */}
                <CustomSelect
                    value={filterType}
                    onChange={setFilterType}
                    placeholder="Type"
                    className="w-[130px]"
                    options={[
                        { value: "All", label: "All Types" },
                        { value: "Monster", label: "Monster" },
                        { value: "Spell", label: "Spell" },
                        { value: "Trap", label: "Trap" },
                        { value: "Fusion", label: "Fusion" },
                        { value: "Synchro", label: "Synchro" },
                        { value: "XYZ", label: "XYZ" },
                        { value: "Link", label: "Link" },
                        { value: "Ritual", label: "Ritual" },
                        { value: "Pendulum", label: "Pendulum" },
                    ]}
                />

                <CustomSelect
                    value={filterAttribute}
                    onChange={setFilterAttribute}
                    placeholder="Attribute"
                    className="w-[130px]"
                    options={[{ value: "All", label: "All Attr" }, ...attributes]}
                />

                <CustomSelect
                    value={filterRace}
                    onChange={setFilterRace}
                    placeholder="Race"
                    className="w-[130px]"
                    options={[{ value: "All", label: "All Races" }, ...races]}
                />

                <CustomSelect
                    value={filterSet}
                    onChange={setFilterSet}
                    placeholder="Set"
                    className="w-[130px]"
                    options={[{ value: "All", label: "All Sets" }, ...sets]}
                />

                <div className="h-6 w-px bg-gray-700 mx-1"></div>

                 <CustomSelect
                    value={sortType}
                    onChange={setSortType}
                    placeholder="Sort By"
                    className="w-[160px]"
                    options={[
                        { value: "newest", label: "Newest Added" },
                        { value: "name", label: "Name (A-Z)" },
                        { value: "price", label: "Price (High to Low)" },
                        { value: "atk", label: "ATK (High to Low)" },
                        { value: "def", label: "DEF (High to Low)" },
                        { value: "level", label: "Level (High to Low)" },
                    ]}
                />

                <button
                    onClick={clearFilters}
                    className="p-2 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
                    title="Clear Filters"
                >
                    <FilterX className="w-4 h-4" />
                </button>
            </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
                    {filteredAndSortedCards.map(card => (
                        <div
                            key={card.id}
                            onClick={() => setSelectedCard(card)}
                            className="group relative bg-[#1E1E1E] rounded-xl overflow-hidden shadow-black shadow-lg hover:shadow-[0_0_20px_rgba(157,0,255,0.2)] transition-all duration-300 hover:-translate-y-1 border border-gray-800 hover:border-space-violet/50 cursor-pointer"
                        >
                            <div className="aspect-[246/357] overflow-hidden relative">
                                {/* Placeholder */}
                                <div className="absolute inset-0 bg-gray-800 animate-pulse"></div>
                                <img
                                    src={card.image_url}
                                    alt={card.name}
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    loading="lazy"
                                    onLoad={(e) => e.target.previousSibling && (e.target.previousSibling.style.display = 'none')}
                                />
                                {card.quantity > 1 && (
                                    <div className="absolute top-2 right-2 bg-green-500 text-black text-xs font-bold px-2 py-0.5 rounded shadow-lg">
                                        x{card.quantity}
                                    </div>
                                )}
                                <div className="absolute bottom-2 left-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10">
                                    {card.variants.length} Var
                                </div>
                            </div>
                            <div className="p-3">
                                <h3 className="font-bold text-gray-200 text-sm leading-tight truncate" title={card.name}>{card.name}</h3>
                                <div className="flex justify-between items-center mt-1">
                                    <p className="text-[10px] text-gray-500 font-mono">{card.id}</p>
                                    {/* Show range or max price */}
                                    <p className="text-[10px] text-space-violet font-medium">
                                        {card.variants.length > 1 ? 'from ' : ''}
                                        ${(card.variants.length > 1
                                            ? Math.min(...card.variants.map(v => v.price || 0))
                                            : (card.price || 0)).toFixed(2)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-[#1E1E1E] rounded-xl border border-gray-800 overflow-hidden">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-black/50 text-xs uppercase text-gray-500 sticky top-0 z-10 backdrop-blur-sm">
                            <tr>
                                <th className="px-6 py-3 font-medium">Card</th>
                                <th className="px-6 py-3 font-medium">Type</th>
                                <th className="px-6 py-3 font-medium text-right">ATK / DEF</th>
                                <th className="px-6 py-3 font-medium text-center">Level</th>
                                <th className="px-6 py-3 font-medium text-right">Passcode</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {filteredAndSortedCards.map(card => (
                                <tr
                                    key={card.id}
                                    onClick={() => setSelectedCard(card)}
                                    className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                                >
                                    <td className="px-6 py-4 font-medium text-white flex items-center gap-3">
                                        <div className="w-8 h-12 bg-black rounded overflow-hidden flex-shrink-0 relative">
                                             <img src={card.image_url} className="w-full h-full object-cover" alt="" />
                                             {card.quantity > 1 && (
                                                <div className="absolute top-0 right-0 bg-green-500 text-black text-[8px] font-bold px-1 rounded-bl">x{card.quantity}</div>
                                             )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                {card.name}
                                            </div>
                                            <div className="text-[10px] text-gray-500">{card.variants.length} Variants Owned</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">{card.type}</td>
                                    <td className="px-6 py-4 text-right">
                                        {card.atk != null ? <span className="text-red-400 font-bold">{card.atk}</span> : '-'} / {' '}
                                        {card.def != null ? <span className="text-blue-400 font-bold">{card.def}</span> : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {card.level != null ? <span className="text-yellow-500">★ {card.level}</span> : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="font-mono">{card.id}</div>
                                        <div className="text-space-violet text-xs font-bold">Total: ${card.totalValue.toFixed(2)}</div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {filteredAndSortedCards.length === 0 && (
                <div className="text-center py-20 text-gray-600">
                    <p>No cards found.</p>
                </div>
            )}
        </div>

        {selectedCard && (
            <CardDetailModal
                card={selectedCard}
                onClose={() => {
                    setSelectedCard(null);
                    loadCollection(); // Reload to reflect changes made in modal
                }}
            />
        )}
    </div>
  );
}