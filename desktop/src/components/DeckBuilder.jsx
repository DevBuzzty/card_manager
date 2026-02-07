import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Upload, FileUp, AlertTriangle, Download, BarChart2, PieChart as PieChartIcon } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';

export default function DeckBuilder() {
  const [decks, setDecks] = useState([]);
  const [activeDeck, setActiveDeck] = useState(null); // { id, name, cards: [] }
  const [collection, setCollection] = useState([]);
  const [filter, setFilter] = useState('');
  const [showStats, setShowStats] = useState(false);

  // Deck Creation State
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');

  // Deck State
  const [mainDeck, setMainDeck] = useState([]);
  const [extraDeck, setExtraDeck] = useState([]);
  const [sideDeck, setSideDeck] = useState([]);

  useEffect(() => {
    if (window.api) {
        window.api.getDecks().then(setDecks);
        window.api.getCollection().then(setCollection);
    }
  }, []);

  const handleCreateDeck = async (e) => {
      e.preventDefault();
      if (!newDeckName.trim()) return;

      if (window.api) {
          const newDeck = await window.api.createDeck(newDeckName);
          setDecks([newDeck, ...decks]);
          setActiveDeck(newDeck);
          setMainDeck([]);
          setExtraDeck([]);
          setSideDeck([]);
          setIsCreating(false);
          setNewDeckName('');
      }
  };

  const handleLoadDeck = async (deck) => {
      if (window.api) {
          const details = await window.api.getDeckDetails(deck.id);
          setActiveDeck(deck);

          const main = [], extra = [], side = [];
          details.forEach(c => {
              if (c.type === 'extra') extra.push(c);
              else if (c.type === 'side') side.push(c);
              else main.push(c);
          });
          setMainDeck(main);
          setExtraDeck(extra);
          setSideDeck(side);
      }
  };

  const handleDeleteDeck = async (id) => {
      if (!confirm("Delete this deck?")) return;
      if (window.api) {
          await window.api.deleteDeck(id);
          setDecks(decks.filter(d => d.id !== id));
          if (activeDeck && activeDeck.id === id) setActiveDeck(null);
      }
  };

  const handleSaveDeck = async () => {
      if (!activeDeck || !window.api) return;
      const allCards = [
          ...mainDeck.map(c => ({ id: c.card_id, type: 'main', quantity: c.quantity })),
          ...extraDeck.map(c => ({ id: c.card_id, type: 'extra', quantity: c.quantity })),
          ...sideDeck.map(c => ({ id: c.card_id, type: 'side', quantity: c.quantity }))
      ];
      await window.api.saveDeck(activeDeck.id, allCards);
      alert("Deck saved!");
  };

  const handleImportYdk = async () => {
      if (window.api) {
          const result = await window.api.importDeckYdk();
          if (result && !result.canceled && result.deck) {
              const newDeck = await window.api.createDeck(result.name || "Imported Deck");
              setDecks([newDeck, ...decks]);
              setActiveDeck(newDeck);

              // Sort into buckets
              const main = [], extra = [], side = [];
              result.deck.forEach(c => {
                  // Find details in collection to show images immediately if owned, else placeholder
                  const cardInfo = collection.find(col => col.id === c.id) || { id: c.id, name: 'Unknown / Not Owned', image_url: `https://images.ygoprodeck.com/images/cards/${c.id}.jpg` };
                  const deckCard = { ...cardInfo, card_id: c.id, quantity: 1 };

                  if (c.type === 'extra') extra.push(deckCard);
                  else if (c.type === 'side') side.push(deckCard);
                  else main.push(deckCard);
              });
              setMainDeck(main);
              setExtraDeck(extra);
              setSideDeck(side);

              // Auto-save initial structure
              const allCards = result.deck.map(c => ({ id: c.id, type: c.type, quantity: 1 }));
              await window.api.saveDeck(newDeck.id, allCards);
          }
      }
  };

  const handleExportYdk = async () => {
      if (!activeDeck || !window.api) return;

      let content = '#created by YuGiOhCardManager\n#main\n';
      mainDeck.forEach(c => {
          for(let i=0; i<c.quantity; i++) content += `${c.card_id}\n`;
      });
      content += '#extra\n';
      extraDeck.forEach(c => {
          for(let i=0; i<c.quantity; i++) content += `${c.card_id}\n`;
      });
      content += '!side\n';
      sideDeck.forEach(c => {
          for(let i=0; i<c.quantity; i++) content += `${c.card_id}\n`;
      });

      const res = await window.api.exportDeckYdk({ name: activeDeck.name, content });
      if (res.success) alert("Deck exported!");
      else if (!res.canceled) alert("Export failed: " + res.error);
  };

  const addToDeck = (card) => {
      if (!activeDeck) {
          alert("Please select or create a deck first.");
          return;
      }
      // Determine destination based on type
      const isExtra = card.type && (card.type.includes('Fusion') || card.type.includes('Synchro') || card.type.includes('XYZ') || card.type.includes('Link'));
      const targetDeck = isExtra ? extraDeck : mainDeck;
      const setTarget = isExtra ? setExtraDeck : setMainDeck;

      // Check limit (3 copies)
      const existing = targetDeck.find(c => c.card_id === card.id);
      if (existing) {
          if (existing.quantity >= 3) return;
          setTarget(prev => prev.map(c => c.card_id === card.id ? { ...c, quantity: c.quantity + 1 } : c));
      } else {
          setTarget(prev => [...prev, { ...card, card_id: card.id, quantity: 1 }]);
      }
  };

  const removeFromDeck = (cardId, deckType) => {
      const setter = deckType === 'main' ? setMainDeck : (deckType === 'extra' ? setExtraDeck : setSideDeck);
      setter(prev => {
          const existing = prev.find(c => c.card_id === cardId);
          if (existing.quantity > 1) {
              return prev.map(c => c.card_id === cardId ? { ...c, quantity: c.quantity - 1 } : c);
          }
          return prev.filter(c => c.card_id !== cardId);
      });
  };

  const filteredCollection = collection.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));

  // Sub-component for a card row in deck list
  const DeckCardRow = ({ card, type }) => {
      // Check ownership
      const owned = collection.find(c => c.id === card.card_id);
      const ownedQty = owned ? owned.quantity : 0;
      const missing = card.quantity > ownedQty;

      return (
          <div
            onClick={() => removeFromDeck(card.card_id, type)}
            className="flex items-center justify-between p-2 hover:bg-red-500/10 rounded cursor-pointer group border-b border-gray-800"
          >
              <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-bold text-gray-400 w-4">{card.quantity}</span>
                  <div className="w-8 h-8 bg-black rounded overflow-hidden flex-shrink-0">
                      <img src={card.image_url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <span className={`text-sm truncate ${missing ? 'text-red-400' : 'text-gray-300'}`}>{card.name}</span>
              </div>
              {missing && (
                  <div className="flex items-center text-xs text-red-500" title={`You own ${ownedQty}, need ${card.quantity}`}>
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      {ownedQty}/{card.quantity}
                  </div>
              )}
          </div>
      );
  };

  // Stats Components
  const DeckStats = () => {
      const allCards = [...mainDeck, ...extraDeck, ...sideDeck];
      // Type breakdown (Monster, Spell, Trap) - Main Deck Only usually matters for ratios
      let monsters = 0, spells = 0, traps = 0;
      mainDeck.forEach(c => {
          if (c.type && c.type.includes('Monster')) monsters += c.quantity;
          else if (c.type && c.type.includes('Spell')) spells += c.quantity;
          else if (c.type && c.type.includes('Trap')) traps += c.quantity;
      });

      const typeData = [
          { name: 'Monster', value: monsters, color: '#A68349' }, // Orange/Brown
          { name: 'Spell', value: spells, color: '#1D9E74' },   // Green
          { name: 'Trap', value: traps, color: '#BC5A84' }     // Pink
      ].filter(d => d.value > 0);

      // Attribute breakdown (All cards)
      const attrCounts = {};
      allCards.forEach(c => {
          if (c.attribute) {
              attrCounts[c.attribute] = (attrCounts[c.attribute] || 0) + c.quantity;
          }
      });
      const attrData = Object.keys(attrCounts).map(k => ({ name: k, value: attrCounts[k] }));

      return (
          <div className="grid grid-cols-2 gap-4 h-64 mb-4">
              <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Card Types (Main)</h4>
                  <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                          <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                              {typeData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                              ))}
                          </Pie>
                          <RechartsTooltip contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                      </PieChart>
                  </ResponsiveContainer>
              </div>
              <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Attributes</h4>
                   <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={attrData}>
                          <XAxis dataKey="name" stroke="#666" fontSize={10} />
                          <YAxis stroke="#666" fontSize={10} />
                          <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                          <Bar dataKey="value" fill="#9D00FF" radius={[4, 4, 0, 0]} />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>
      );
  };

  return (
    <div className="flex h-full gap-6">
        {/* Left: Deck List & Collection */}
        <div className="w-1/3 flex flex-col gap-4">
            <div className="bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 flex flex-col h-1/3">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-white">My Decks</h3>
                    <div className="flex gap-2">
                        <button onClick={handleImportYdk} className="p-1.5 bg-gray-800 hover:text-white text-gray-400 rounded transition-colors" title="Import .ydk">
                            <Upload className="w-4 h-4" />
                        </button>
                        <button onClick={() => setIsCreating(true)} className="p-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded transition-colors" title="New Deck">
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {isCreating && (
                    <form onSubmit={handleCreateDeck} className="mb-4 bg-black/40 p-3 rounded-lg border border-space-violet/50 animate-in fade-in slide-in-from-top-2">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Deck Name..."
                            className="w-full bg-[#1a1a1a] border border-gray-700 text-white px-3 py-2 rounded text-sm mb-2 focus:border-space-violet focus:outline-none"
                            value={newDeckName}
                            onChange={e => setNewDeckName(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="text-xs text-gray-400 hover:text-white px-2 py-1"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!newDeckName.trim()}
                                className="text-xs bg-space-violet hover:bg-space-violet-dark text-white px-3 py-1 rounded disabled:opacity-50"
                            >
                                Create
                            </button>
                        </div>
                    </form>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                    {decks.map(deck => (
                        <div
                            key={deck.id}
                            onClick={() => handleLoadDeck(deck)}
                            className={`flex justify-between items-center p-2 rounded cursor-pointer ${activeDeck?.id === deck.id ? 'bg-space-violet/20 border border-space-violet/50 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        >
                            <span className="truncate">{deck.name}</span>
                            {activeDeck?.id === deck.id && (
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteDeck(deck.id); }} className="text-gray-500 hover:text-red-400">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 flex flex-col flex-1 h-2/3">
                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Search Collection..."
                        className="w-full bg-[#1a1a1a] border border-gray-800 text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-space-violet"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-3 gap-2 content-start">
                    {filteredCollection.map(card => (
                        <div key={card.id} onClick={() => addToDeck(card)} className="cursor-pointer group relative aspect-[2/3]">
                            <img src={card.image_url} alt={card.name} className="w-full h-full object-cover rounded border border-gray-800 group-hover:border-space-violet transition-colors" />
                            {/* Quantity badge */}
                            <div className="absolute bottom-0 right-0 bg-black/80 text-white text-[10px] px-1 font-mono">x{card.quantity}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Right: Active Deck Editor */}
        <div className="flex-1 bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 flex flex-col">
            {activeDeck ? (
                <>
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-bold text-white">{activeDeck.name}</h2>
                            <button
                                onClick={() => setShowStats(!showStats)}
                                className={`p-1.5 rounded-lg transition-colors ${showStats ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                                title="Toggle Stats"
                            >
                                {showStats ? <PieChartIcon className="w-4 h-4" /> : <BarChart2 className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={handleExportYdk} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium border border-gray-700">
                                <Download className="w-4 h-4 mr-2" />
                                Export YDK
                            </button>
                            <button onClick={handleSaveDeck} className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors font-medium shadow-lg shadow-space-violet/20">
                                <Save className="w-4 h-4 mr-2" />
                                Save Deck
                            </button>
                        </div>
                    </div>

                    {showStats && <DeckStats />}

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
                        {/* Main Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1 sticky top-0 bg-[#1E1E1E] z-10">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Main Deck</h3>
                                <span className="text-xs text-gray-500">{mainDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {mainDeck.length === 0 && <p className="text-gray-600 text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" />)}
                            </div>
                        </div>

                        {/* Extra Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1 sticky top-0 bg-[#1E1E1E] z-10">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Extra Deck</h3>
                                <span className="text-xs text-gray-500">{extraDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" />)}
                            </div>
                        </div>

                        {/* Side Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1 sticky top-0 bg-[#1E1E1E] z-10">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Side Deck</h3>
                                <span className="text-xs text-gray-500">{sideDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" />)}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <FileUp className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">Select or Create a Deck</p>
                </div>
            )}
        </div>
    </div>
  );
}