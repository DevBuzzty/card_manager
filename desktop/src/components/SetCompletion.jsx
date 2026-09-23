import { useState, useEffect } from 'react';
import { ChevronRight, AlertCircle } from 'lucide-react';

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

    if (loading) return <div className="p-4 text-center text-muted">Statistiken werden geladen…</div>;

    return (
        <div className="bg-surface rounded-2xl border border-line p-6 h-full flex flex-col">
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
                {sets.length === 0 && (
                    <div className="text-center text-muted py-8">Keine Set-Daten vorhanden.</div>
                )}
                {sets.map(set => (
                    <div key={set.name} className="bg-bg/40 rounded-xl p-3 flex items-center justify-between border border-line/50">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-surface-2 rounded-lg flex items-center justify-center font-bold text-muted">
                                {set.name.substring(0, 3)}
                            </div>
                            <div>
                                <h4 className="font-bold text-text">{set.name}</h4>
                                <p className="text-xs text-muted">{set.count} Karten gesamt</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xl font-bold text-accent">{set.uniqueCount}</span>
                            <span className="text-xs text-muted block">Verschiedene</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
