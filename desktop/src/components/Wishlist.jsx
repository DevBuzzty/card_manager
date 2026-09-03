import { useState, useEffect } from 'react';
import { Search, Plus, Trash2, ExternalLink, Heart } from 'lucide-react';
import { fmtEUR } from '../utils/format';

export default function Wishlist() {
    const [wishlist, setWishlist] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [loading, setLoading] = useState(false);

    const loadWishlist = async () => {
        if (window.api) {
            const list = await window.api.getWishlist();
            setWishlist(list);
        }
    };

    useEffect(() => {
        setTimeout(() => loadWishlist(), 0);
    }, []);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim() || searchQuery.length < 3) return;

        setLoading(true);
        if (window.api) {
            const results = await window.api.searchOnline(searchQuery);
            setSearchResults(results.slice(0, 20)); // Limit to 20
        }
        setLoading(false);
    };

    const addToWishlist = async (card) => {
        if (window.api) {
            const image = card.card_images?.[0]?.image_url || '';
            const price = card.card_prices?.[0]?.cardmarket_price || 0;

            const result = await window.api.addToWishlist({
                id: card.id,
                name: card.name,
                image_url: image,
                price: parseFloat(price)
            });

            if (result.success) {
                loadWishlist();
                // Mark as added in local state if needed, or just let re-render handle it
                setSearchResults(prev => [...prev]);
            } else {
                alert(result.message || "Failed to add");
            }
        }
    };

    const removeFromWishlist = async (id) => {
        if (window.api) {
            await window.api.removeFromWishlist(id);
            setWishlist(prev => prev.filter(item => item.id !== id));
        }
    };

    return (
        <div className="h-full flex flex-col gap-6">
            <div className="flex justify-between items-center bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Wishlist</h1>
                    <p className="text-gray-400">Track cards you want to acquire.</p>
                </div>
                <button
                    onClick={() => setIsSearching(!isSearching)}
                    className={`flex items-center px-4 py-2 rounded-lg font-medium transition-colors ${isSearching ? 'bg-gray-700 text-white' : 'bg-space-violet text-white hover:bg-space-violet-dark'}`}
                >
                    {isSearching ? 'View Wishlist' : 'Add Cards'}
                    {isSearching ? null : <Plus className="w-4 h-4 ml-2" />}
                </button>
            </div>

            {isSearching ? (
                <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 flex-1 flex flex-col">
                    <form onSubmit={handleSearch} className="flex gap-4 mb-6">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Search Card Name (min 3 chars)..."
                            className="flex-1 bg-black/40 border border-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-space-violet"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={loading || searchQuery.length < 3}
                            className="bg-space-violet hover:bg-space-violet-dark text-white px-6 py-3 rounded-lg font-bold disabled:opacity-50"
                        >
                            {loading ? 'Searching...' : 'Search'}
                        </button>
                    </form>

                    <div className="flex-1 overflow-y-auto custom-scrollbar grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {searchResults.map(card => {
                            const inWishlist = wishlist.some(w => w.card_id === String(card.id));
                            return (
                                <div key={card.id} className="bg-black/40 p-3 rounded-xl border border-gray-800 hover:border-space-violet transition-colors group relative">
                                    <div className="aspect-[2/3] mb-3 overflow-hidden rounded-lg">
                                        <img src={card.card_images?.[0]?.image_url_small} alt={card.name} className="w-full h-full object-cover" />
                                    </div>
                                    <h3 className="font-bold text-sm text-gray-200 truncate mb-1" title={card.name}>{card.name}</h3>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-space-violet font-mono">
                                            {fmtEUR(card.card_prices?.[0]?.cardmarket_price)}
                                        </span>
                                        <button
                                            onClick={() => addToWishlist(card)}
                                            disabled={inWishlist}
                                            className={`p-1.5 rounded-lg transition-colors ${inWishlist ? 'bg-green-500/20 text-green-500 cursor-default' : 'bg-gray-800 hover:bg-space-violet text-gray-400 hover:text-white'}`}
                                            title={inWishlist ? "In Wishlist" : "Add to Wishlist"}
                                        >
                                            {inWishlist ? <Heart className="w-4 h-4 fill-current" /> : <Plus className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {searchResults.length === 0 && !loading && searchQuery && (
                            <div className="col-span-full text-center text-gray-500 py-10">No results found.</div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 flex-1 overflow-y-auto custom-scrollbar">
                    {wishlist.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                            <Heart className="w-16 h-16 mb-4 opacity-20" />
                            <p className="text-xl font-medium">Your wishlist is empty</p>
                            <button onClick={() => setIsSearching(true)} className="text-space-violet hover:underline mt-2">Find cards to add</button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {wishlist.map(item => (
                                <div key={item.id} className="bg-black/40 p-3 rounded-xl border border-gray-800 hover:border-gray-600 transition-colors group">
                                    <div className="aspect-[2/3] mb-3 overflow-hidden rounded-lg relative">
                                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => removeFromWishlist(item.id)}
                                            className="absolute top-2 right-2 p-1.5 bg-black/60 text-red-400 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                                            title="Remove"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <h3 className="font-bold text-sm text-gray-200 truncate mb-1" title={item.name}>{item.name}</h3>
                                    <div className="text-xs text-gray-500 font-mono">Added: {new Date(item.created_at).toLocaleDateString()}</div>
                                    <div className="mt-2 text-xs text-space-violet font-bold">{fmtEUR(item.price)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
