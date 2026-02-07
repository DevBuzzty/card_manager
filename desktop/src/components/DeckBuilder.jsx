import { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Upload, FileUp, AlertTriangle } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { getCardImageUrl } from '../constants/api';

export default function DeckBuilder() {
  const [decks, setDecks] = useState([]);
  const [activeDeck, setActiveDeck] = useState(null); // { id, name, cards: [] }
  const [collection, setCollection] = useState([]);
  const [filter, setFilter] = useState('');

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

  const handleCreateDeck = async () => {
      const name = prompt("Enter deck name:");
      if (!name) return;
      if (window.api) {
          const newDeck = await window.api.createDeck(name);
          setDecks([newDeck, ...decks]);
          setActiveDeck(newDeck);
          setMainDeck([]);
          setExtraDeck([]);
          setSideDeck([]);
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
                  const cardInfo = collection.find(col => col.id === c.id) || { id: c.id, name: 'Unknown / Not Owned', image_url: getCardImageUrl(c.id) };
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

  const addToDeck = (card) => {
      if (!activeDeck) return;
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
                        <button onClick={handleCreateDeck} className="p-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded transition-colors" title="New Deck">
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>
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
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-white">{activeDeck.name}</h2>
                        <button onClick={handleSaveDeck} className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors">
                            <Save className="w-4 h-4 mr-2" />
                            Save Deck
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
                        {/* Main Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1">
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
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1">
                                <h3 className="text-sm font-bold uppercase text-gray-400">Extra Deck</h3>
                                <span className="text-xs text-gray-500">{extraDeck.reduce((a,c) => a+c.quantity, 0)} cards</span>
                            </div>
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" />)}
                            </div>
                        </div>

                        {/* Side Deck */}
                        <div>
                            <div className="flex justify-between items-center mb-2 border-b border-gray-700 pb-1">
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
