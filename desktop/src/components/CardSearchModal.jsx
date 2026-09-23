import { useState } from 'react';
import { X, Search, Loader2, Plus } from 'lucide-react';

export default function CardSearchModal({ onClose, onSelect }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    const handleSearch = async (e) => {
        e.preventDefault();
        const q = query.trim();
        const isPasscode = /^\d+$/.test(q);
        // Name search needs >=3 chars; a numeric passcode may be shorter.
        if (!q || (!isPasscode && q.length < 3)) return;

        setLoading(true);
        try {
            if (window.api) {
                // Backend routes numeric queries to an id lookup, text to fuzzy name search.
                const data = await window.api.searchOnline(q);
                setResults(data.slice(0, 50));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const isPasscodeQuery = /^\d+$/.test(query.trim());

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-surface w-full max-w-4xl max-h-[85vh] rounded-2xl border border-line shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-line flex justify-between items-center bg-surface-2">
                    <h2 className="text-2xl font-bold text-text">Manual Card Search</h2>
                    <button onClick={onClose} className="p-2 hover:bg-surface-2 rounded-full text-muted hover:text-text transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-6 border-b border-line bg-surface">
                    <form onSubmit={handleSearch} className="flex gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search by Card Name or Passcode..."
                                className="w-full bg-bg/40 border border-line text-text pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:border-accent transition-colors"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || (!isPasscodeQuery && query.trim().length < 3) || !query.trim()}
                            className="bg-accent hover:brightness-110 text-accent-fg px-6 rounded-xl font-bold transition-colors disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
                        </button>
                    </form>
                    <p className="text-xs text-muted mt-2 ml-1">Tip: Search by card name, or type an 8-digit passcode for an exact lookup.</p>
                </div>

                {/* Results */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-bg">
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {results.length === 0 && !loading && (
                            <div className="col-span-full text-center text-muted py-12">
                                <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <p>Enter a card name to search.</p>
                            </div>
                        )}
                        {results.map(card => (
                            <div key={card.id} className="bg-surface p-3 rounded-xl border border-line hover:border-accent transition-colors group flex flex-col">
                                <div className="aspect-[2/3] mb-3 overflow-hidden rounded-lg relative">
                                    <img
                                        src={card.card_images?.[0]?.image_url_small}
                                        alt={card.name}
                                        className="w-full h-full object-cover"
                                    />
                                    {/* Overlay Button */}
                                    <div className="absolute inset-0 bg-bg/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <button
                                            onClick={() => onSelect(card)}
                                            className="bg-accent text-accent-fg px-4 py-2 rounded-lg font-bold transform scale-90 group-hover:scale-100 transition-transform"
                                        >
                                            Select
                                        </button>
                                    </div>
                                </div>
                                <h3 className="font-bold text-sm text-text truncate mb-1" title={card.name}>{card.name}</h3>
                                <div className="flex justify-between items-end mt-auto">
                                    <span className="text-[10px] text-muted font-mono">{card.type}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
