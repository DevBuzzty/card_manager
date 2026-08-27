import { useEffect, useState, useMemo, useRef } from 'react';
import { Search, RefreshCw, LayoutGrid, List as ListIcon, Database, FilterX } from 'lucide-react';
import { Grid } from 'react-window';
import CardDetailModal from './CardDetailModal';
import CustomSelect from './CustomSelect';
import CardTile from './CardTile';
import { getRarityInfo } from '../utils/rarity.js';

// Simple AutoSizer replacement
const AutoSizer = ({ children }) => {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!ref.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        resizeObserver.observe(ref.current);
        return () => resizeObserver.disconnect();
    }, []);

    return (
        <div ref={ref} style={{ width: '100%', height: '100%' }}>
            {size.width > 0 && size.height > 0 && children(size)}
        </div>
    );
};

export default function CollectionList({ isUpdating, setUpdateProgress }) {
  const [rawCards, setRawCards] = useState([]);
  const [filter, setFilter] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [localUpdating, setLocalUpdating] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [sortType, setSortType] = useState('newest');

  // Filters
  const [filterType, setFilterType] = useState('All');
  const [filterAttribute, setFilterAttribute] = useState('All');
  const [filterRace, setFilterRace] = useState('All');
  const [filterSet, setFilterSet] = useState('All');
  const [filterLang, setFilterLang] = useState('All');
  const [filterRarity, setFilterRarity] = useState('All');
  const [segment, setSegment] = useState('all'); // all | unknown | incomplete | foils
  const [segmentBusy, setSegmentBusy] = useState(false);

  const updating = isUpdating || localUpdating;

  const loadCollection = async () => {
    if (window.api) {
      const result = await window.api.getCollection();
      setRawCards(result);
    }
  };

  useEffect(() => { loadCollection(); }, [updating]);

  // Reload when the sync cycle pulls changes from the phone
  useEffect(() => {
    if (!window.api || !window.api.onCollectionChanged) return;
    const cleanup = window.api.onCollectionChanged(() => loadCollection());
    return () => cleanup && cleanup();
  }, []);

  const handleUpdate = async (mode) => {
    if (!window.api || updating) return;
    if (!confirm(mode === 'all' ? "Update ALL cards?" : "Fetch missing details?")) return;
    setLocalUpdating(true);
    setUpdateProgress({ current: 0, total: 0 });
    try {
        const result = mode === 'all' ? await window.api.updateAllCards() : await window.api.updateMissingCards();
        if (result.success) { alert(`Updated ${result.updatedCount} cards.`); loadCollection(); }
        else alert("Failed: " + result.error);
    } catch (e) { alert("Update failed."); }
    finally { setLocalUpdating(false); setUpdateProgress(null); }
  };

  const groupedCards = useMemo(() => {
      const groups = {};
      rawCards.forEach(card => {
          if (!groups[card.id]) {
              groups[card.id] = {
                  ...card, quantity: 0, totalValue: 0, variants: [], maxPrice: 0, newestDate: new Date(0), sets: new Set(), languages: new Set(), rarities: new Set()
              };
          }
          const g = groups[card.id];
          g.quantity += (card.quantity || 1);
          g.totalValue += (card.price || 0) * (card.quantity || 1);
          g.variants.push(card);
          if (card.set_code) g.sets.add(card.set_code.split('-')[0]);
          if (card.language) g.languages.add(card.language);
          if (card.rarity) g.rarities.add(card.rarity);
          if ((card.price || 0) > g.maxPrice) g.maxPrice = card.price || 0;
          const cDate = new Date(card.created_at);
          if (cDate > g.newestDate) g.newestDate = cDate;
      });
      return Object.values(groups);
  }, [rawCards]);

  const { attributes, races, sets, rarities } = useMemo(() => {
      const attrs = new Set(), rcs = new Set(), sts = new Set(), rars = new Set();
      groupedCards.forEach(c => {
          if (c.attribute) attrs.add(c.attribute);
          if (c.race) rcs.add(c.race);
          c.sets.forEach(s => sts.add(s));
          c.rarities.forEach(r => rars.add(r));
      });
      return {
          attributes: Array.from(attrs).sort().map(a => ({ value: a, label: a })),
          races: Array.from(rcs).sort().map(r => ({ value: r, label: r })),
          sets: Array.from(sts).sort().map(s => ({ value: s, label: s })),
          rarities: Array.from(rars).sort().map(r => ({ value: r, label: r }))
      };
  }, [groupedCards]);

  // A grouped card is "incomplete" if a monster is missing atk/def/level, or anything lacks an image.
  const isIncomplete = (c) => {
      const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
      const isLink = c.type && c.type.includes('Link');
      if (isMonster) {
          if (c.atk == null) return true;
          if (!isLink && c.def == null) return true;
          if (c.level == null) return true;
          return false;
      }
      return !c.image_url;
  };
  const hasUnknownVariant = (c) => c.variants && c.variants.some(v => v.set_code === 'Unknown');
  const hasFoilVariant = (c) => Array.from(c.rarities).some(r => !!getRarityInfo(r).foil);

  const segmentCounts = useMemo(() => ({
      all: groupedCards.length,
      unknown: groupedCards.filter(hasUnknownVariant).length,
      incomplete: groupedCards.filter(isIncomplete).length,
      foils: groupedCards.filter(hasFoilVariant).length,
  }), [groupedCards]);

  const filtered = useMemo(() => {
      return groupedCards.filter(c => {
        if (segment === 'unknown' && !hasUnknownVariant(c)) return false;
        if (segment === 'incomplete' && !isIncomplete(c)) return false;
        if (segment === 'foils' && !hasFoilVariant(c)) return false;
        const q = filter.trim().toLowerCase();
        const matchesSearch = !q
            || (c.name && c.name.toLowerCase().includes(q))
            || (c.id && String(c.id).includes(filter.trim()))
            || (c.race && c.race.toLowerCase().includes(q))
            || (c.attribute && c.attribute.toLowerCase().includes(q))
            || Array.from(c.sets).some(s => s.toLowerCase().includes(q))
            || Array.from(c.rarities).some(r => r.toLowerCase().includes(q));
        if (!matchesSearch) return false;
        if (filterType !== 'All' && (!c.type || !c.type.includes(filterType))) return false;
        if (filterAttribute !== 'All' && c.attribute !== filterAttribute) return false;
        if (filterRace !== 'All' && c.race !== filterRace) return false;
        if (filterSet !== 'All' && !Array.from(c.sets).includes(filterSet)) return false;
        if (filterLang !== 'All' && !Array.from(c.languages).includes(filterLang)) return false;
        if (filterRarity !== 'All' && !Array.from(c.rarities).includes(filterRarity)) return false;
        return true;
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
  }, [groupedCards, filter, filterType, filterAttribute, filterRace, filterSet, filterLang, filterRarity, sortType, segment]);

  const clearFilters = () => {
      setFilter(''); setFilterType('All'); setFilterAttribute('All'); setFilterRace('All'); setFilterSet('All'); setFilterLang('All'); setFilterRarity('All');
  };

  // Virtualized Grid Cell Renderer
  const Cell = ({ columnIndex, rowIndex, style, ...props }) => {
      // In this version of react-window, data is passed via props merged from cellProps?
      // Wait, .d.ts says: cellComponent receives (props: { ... } & CellProps)
      // So items and columnCount should be in props directly if I pass them in cellProps.

      const { items, columnCount } = props;
      // Note: columnIndex and rowIndex are also in props.

      const index = rowIndex * columnCount + columnIndex;
      if (index >= items.length) return null;
      const card = items[index];

      return (
          <div style={{ ...style, padding: 8 }}>
              <CardTile
                  card={{ ...card, price: card.variants && card.variants.length > 1 ? Math.min(...card.variants.map(v => v.price || 0)) : (card.price || 0) }}
                  onClick={() => setSelectedCard(card)}
              />
          </div>
      );
  };

  const runUnknownAction = async (kind) => {
      if (!window.api || segmentBusy) return;
      const msg = kind === 'merge'
          ? "Merge all 'Unknown' cards into their most common owned set variant?"
          : "Assign all 'Unknown' cards to their cheapest available set (online, may take a while)?";
      if (!confirm(msg)) return;
      setSegmentBusy(true);
      try {
          const res = kind === 'merge' ? await window.api.mergeUnknownCards() : await window.api.convertUnknownsToDefault();
          if (res.success) { alert(kind === 'merge' ? `Merged ${res.merged} cards.` : `Converted ${res.converted} cards.`); loadCollection(); }
          else alert('Failed: ' + res.error);
      } catch { alert('Action failed.'); }
      finally { setSegmentBusy(false); }
  };

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
        <div className="flex flex-col gap-4 mb-4 bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 shrink-0">
            {/* Header Controls (Same as before) */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-space-white">My Collection</h2>
                    <span className="text-gray-500 text-sm">({filtered.length} Cards)</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => handleUpdate('missing')} disabled={updating} className="flex items-center px-3 py-1.5 bg-gray-800 hover:bg-space-violet text-gray-400 hover:text-white rounded-lg text-xs font-medium border border-gray-700">
                        <Database className="w-3 h-3 mr-2" /> Fetch Missing
                    </button>
                    <button onClick={() => handleUpdate('all')} disabled={updating} className="p-2 bg-gray-800 hover:bg-space-violet text-gray-400 hover:text-white rounded-full">
                        <RefreshCw className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Segment control */}
            <div className="flex flex-wrap items-center gap-2">
                {[
                    { id: 'all', label: 'All' },
                    { id: 'unknown', label: 'Unknown' },
                    { id: 'incomplete', label: 'Incomplete' },
                    { id: 'foils', label: 'Foils' },
                ].map(s => (
                    <button
                        key={s.id}
                        onClick={() => setSegment(s.id)}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-display text-xs font-medium transition-colors ${
                            segment === s.id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'bg-obsidian-700 text-ink-muted hover:text-ink border border-line'
                        }`}
                    >
                        {s.label}
                        <span className={`font-mono text-[9.5px] px-1.5 rounded-full ${segment === s.id ? 'bg-black/25' : 'bg-black/30'}`}>{segmentCounts[s.id]}</span>
                    </button>
                ))}
            </div>

            {/* Unknown batch actions */}
            {segment === 'unknown' && segmentCounts.unknown > 0 && (
                <div className="flex items-center gap-3 bg-gold/5 border border-gold/25 rounded-xl px-4 py-3">
                    <span className="text-xs text-ink-muted flex-1">These cards have no specific set code — resolve them to avoid inflated values.</span>
                    <button onClick={() => runUnknownAction('convert')} disabled={segmentBusy} className="px-3 py-1.5 bg-obsidian-600 hover:bg-obsidian-700 text-ink rounded-lg text-xs font-medium border border-line disabled:opacity-50">Convert to Default</button>
                    <button onClick={() => runUnknownAction('merge')} disabled={segmentBusy} className="px-3 py-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg text-xs font-medium disabled:opacity-50">{segmentBusy ? 'Working…' : 'Auto-Merge All'}</button>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <div className="relative group flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input type="text" placeholder="Search..." className="bg-[#1a1a1a] border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg w-full focus:border-space-violet outline-none" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <CustomSelect value={filterType} onChange={setFilterType} placeholder="Type" className="w-[120px]" options={[{ value: "All", label: "Type" }, { value: "Monster", label: "Monster" }, { value: "Spell", label: "Spell" }, { value: "Trap", label: "Trap" }, { value: "Link", label: "Link" }, { value: "XYZ", label: "XYZ" }, { value: "Synchro", label: "Synchro" }, { value: "Fusion", label: "Fusion" }]} />
                <CustomSelect value={filterLang} onChange={setFilterLang} placeholder="Lang" className="w-[90px]" options={[{ value: "All", label: "Lang" }, { value: "DE", label: "DE" }, { value: "EN", label: "EN" }, { value: "JP", label: "JP" }]} />
                <CustomSelect value={filterAttribute} onChange={setFilterAttribute} placeholder="Attr" className="w-[120px]" options={[{ value: "All", label: "Attr" }, ...attributes]} />
                <CustomSelect value={filterRace} onChange={setFilterRace} placeholder="Race" className="w-[130px]" options={[{ value: "All", label: "Race/Type" }, ...races]} />
                <CustomSelect value={filterRarity} onChange={setFilterRarity} placeholder="Rarity" className="w-[130px]" options={[{ value: "All", label: "Rarity" }, ...rarities]} />
                <CustomSelect value={filterSet} onChange={setFilterSet} placeholder="Set" className="w-[120px]" options={[{ value: "All", label: "Set" }, ...sets]} />
                <CustomSelect value={sortType} onChange={setSortType} placeholder="Sort" className="w-[140px]" options={[{ value: "newest", label: "Newest" }, { value: "price", label: "Price" }, { value: "name", label: "Name" }, { value: "atk", label: "ATK" }, { value: "def", label: "DEF" }, { value: "level", label: "Level" }]} />
                <button onClick={clearFilters} className="p-2 text-gray-500 hover:text-red-400"><FilterX className="w-4 h-4" /></button>
            </div>
        </div>

        <div className="flex-1 overflow-hidden">
            {filtered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-600">No cards found.</div>
            ) : (
                <AutoSizer>
                    {({ height, width }) => {
                        // Responsive Column Count
                        const columnWidth = 180;
                        const columnCount = Math.floor(width / columnWidth) || 1;
                        const rowCount = Math.ceil(filtered.length / columnCount);

                        return (
                            <Grid
                                columnCount={columnCount}
                                columnWidth={width / columnCount}
                                defaultHeight={height}
                                rowCount={rowCount}
                                rowHeight={280}
                                width={width}
                                height={height} // Also pass height for Grid style
                                cellProps={{ items: filtered, columnCount }}
                                cellComponent={Cell}
                            />
                        );
                    }}
                </AutoSizer>
            )}
        </div>

        {selectedCard && <CardDetailModal card={selectedCard} onClose={() => { setSelectedCard(null); loadCollection(); }} />}
    </div>
  );
}
