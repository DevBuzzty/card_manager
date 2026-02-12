import { useState, useEffect } from 'react';
import { AlertTriangle, Trash2, Merge, RefreshCw } from 'lucide-react';

export default function UnknownCards() {
    const [unknowns, setUnknowns] = useState([]);
    const [loading, setLoading] = useState(false);

    const loadData = async () => {
        if (!window.api) return;
        // Fetch full collection then filter
        // A dedicated API endpoint would be better, but this works for now
        const allCards = await window.api.getCollection();
        const filtered = allCards.filter(c => c.set_code === 'Unknown');
        setUnknowns(filtered);
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleAutoMerge = async () => {
        if (!confirm("This will merge ALL 'Unknown' cards into their most common set variant found in your collection. If no variant exists, they will remain Unknown. Continue?")) return;

        setLoading(true);
        if (window.api) {
            const res = await window.api.mergeUnknownCards();
            if (res.success) {
                alert(`Merged ${res.merged} cards.`);
                loadData();
            } else {
                alert("Error: " + res.error);
            }
        }
        setLoading(false);
    };

    const handleConvertToDefault = async () => {
        if (!confirm("This will fetch data for ALL remaining 'Unknown' cards and assign them to their default (first available) set code. This is an online operation and may take time. Continue?")) return;

        setLoading(true);
        if (window.api) {
            const res = await window.api.convertUnknownsToDefault();
            if (res.success) {
                alert(`Converted ${res.converted} cards to specific sets.`);
                loadData();
            } else {
                alert("Error: " + res.error);
            }
        }
        setLoading(false);
    };

    const handleDelete = async (card) => {
        if (!confirm(`Delete ${card.quantity}x ${card.name} (Unknown Set)?`)) return;

        // We need a specific delete handler or careful update
        // We can use updateCardMeta to set quantity to 0 (which usually deletes or we handle it)
        // Or specific IPC. Let's assume we can use updateCardMeta to set qty=0.
        // Actually, let's look at `delete-deck` etc. We don't have `delete-card`.
        // We can use `update-card-meta` setting qty to 0.

        if (window.api) {
            await window.api.updateCardMeta({
                passcode: card.id,
                old_set_code: 'Unknown',
                quantity: 0
            });
            loadData();
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6 h-full flex flex-col">
            <div className="flex justify-between items-center bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                        <AlertTriangle className="text-yellow-500 w-8 h-8" />
                        Unknown Cards
                    </h1>
                    <p className="text-gray-400">Cards without a specific set code (Legacy/Imported). These may cause duplicate value counts.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="text-2xl font-bold text-white">{unknowns.length}</p>
                        <p className="text-xs text-gray-500 uppercase">Entries</p>
                    </div>
                    <button
                        onClick={handleConvertToDefault}
                        disabled={loading || unknowns.length === 0}
                        className="flex items-center px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition-colors disabled:opacity-50 border border-gray-600"
                    >
                        <RefreshCw className={`w-5 h-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Convert to Default
                    </button>
                    <button
                        onClick={handleAutoMerge}
                        disabled={loading || unknowns.length === 0}
                        className="flex items-center px-6 py-3 bg-space-violet hover:bg-space-violet-dark text-white rounded-xl font-bold transition-colors disabled:opacity-50"
                    >
                        <Merge className={`w-5 h-5 mr-2 ${loading ? 'animate-pulse' : ''}`} />
                        {loading ? 'Merging...' : 'Auto-Merge All'}
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-[#1E1E1E] rounded-2xl border border-gray-800 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-gray-800 grid grid-cols-12 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <div className="col-span-1">Qty</div>
                    <div className="col-span-6">Card Name</div>
                    <div className="col-span-2">Passcode</div>
                    <div className="col-span-3 text-right">Actions</div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {unknowns.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-600">
                            <RefreshCw className="w-12 h-12 mb-4 opacity-20" />
                            <p>No unknown cards found. Great job!</p>
                        </div>
                    )}
                    {unknowns.map(card => (
                        <div key={card.id} className="p-4 border-b border-gray-800 grid grid-cols-12 items-center hover:bg-white/5 transition-colors group">
                            <div className="col-span-1 font-mono text-yellow-500 font-bold">x{card.quantity}</div>
                            <div className="col-span-6 flex items-center gap-3">
                                <div className="w-8 h-10 bg-black rounded overflow-hidden flex-shrink-0">
                                    <img src={card.image_url} alt="" className="w-full h-full object-cover" />
                                </div>
                                <span className="font-bold text-white truncate">{card.name}</span>
                            </div>
                            <div className="col-span-2 font-mono text-gray-500 text-xs">{card.id}</div>
                            <div className="col-span-3 flex justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => handleDelete(card)}
                                    className="p-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-lg transition-colors"
                                    title="Delete Entry"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
