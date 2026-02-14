import { useState, useEffect } from 'react';
import { Trophy, ChevronRight, AlertCircle } from 'lucide-react';

export default function SetCompletion() {
    const [sets, setSets] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        if (!window.api) {
            setLoading(false);
            return;
        }

        // We need to fetch collection and aggregate manually because DB doesn't track "Total Cards in Set"
        // We can approximate "Total" by checking known cards or just showing "Owned Count"
        // To get REAL completion, we'd need to fetch the full card list of a set from API.
        // For efficiency, we'll just show "Most Collected Sets" by count.

        try {
            const collection = await window.api.getCollection();
            const setMap = new Map();

            collection.forEach(card => {
                if (card.set_code && card.set_code !== 'Unknown') {
                    // Normalize Set Code prefix (e.g. LOB-EN001 -> LOB)
                    const prefix = card.set_code.split('-')[0];
                    if (!setMap.has(prefix)) {
                        setMap.set(prefix, { name: prefix, count: 0, unique: new Set() });
                    }
                    const entry = setMap.get(prefix);
                    entry.count += card.quantity;
                    entry.unique.add(card.id);
                }
            });

            const sorted = Array.from(setMap.values())
                .map(s => ({ ...s, uniqueCount: s.unique.size }))
                .sort((a, b) => b.uniqueCount - a.uniqueCount)
                .slice(0, 10); // Top 10

            setSets(sorted);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-4 text-center text-gray-500">Loading Stats...</div>;

    return (
        <div className="bg-[#1E1E1E] rounded-2xl border border-gray-800 p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white flex items-center">
                    <Trophy className="w-5 h-5 mr-2 text-yellow-500" />
                    Top Collected Sets
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
                {sets.length === 0 && (
                    <div className="text-center text-gray-600 py-8">No set data available.</div>
                )}
                {sets.map(set => (
                    <div key={set.name} className="bg-black/40 rounded-xl p-3 flex items-center justify-between border border-gray-800/50">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center font-bold text-gray-400">
                                {set.name.substring(0, 3)}
                            </div>
                            <div>
                                <h4 className="font-bold text-white">{set.name}</h4>
                                <p className="text-xs text-gray-500">{set.count} Total Cards</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xl font-bold text-space-violet">{set.uniqueCount}</span>
                            <span className="text-xs text-gray-500 block">Unique</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
