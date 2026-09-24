import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Library, Layers, DollarSign, Package, Sparkles } from 'lucide-react';

// Lightweight horizontal-bar distribution (no chart library, keeps the bundle lean).
function BarStat({ title, icon: Icon, data, accent = 'bg-text/20', valueFormatter }) {
    const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;
    return (
        <div className="bg-surface rounded-2xl border border-line p-6 flex flex-col">
            <h3 className="text-sm font-bold text-muted uppercase tracking-wider mb-4 flex items-center">
                {Icon && <Icon className="w-4 h-4 mr-2" />} {title}
            </h3>
            {data.length === 0 ? (
                <p className="text-muted text-sm">No data.</p>
            ) : (
                <div className="space-y-2.5">
                    {data.map(d => (
                        <div key={d.label}>
                            <div className="flex justify-between items-center text-xs mb-1">
                                <span className="text-text truncate pr-2">{d.label}</span>
                                <span className="font-mono text-muted shrink-0">{valueFormatter ? valueFormatter(d.value) : d.value}</span>
                            </div>
                            <div className="h-2 bg-bg/40 rounded-full overflow-hidden">
                                <div className={`h-full ${accent} rounded-full transition-all`} style={{ width: `${(d.value / max) * 100}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

const Tile = ({ icon: Icon, label, value, color = 'bg-surface-2' }) => (
    <div className="bg-surface p-5 rounded-2xl border border-line relative overflow-hidden">
        <div className={`absolute right-[-20px] top-[-20px] w-20 h-20 rounded-full opacity-10 ${color}`} />
        <div className="flex items-center gap-3 relative z-10">
            <div className={`p-2.5 rounded-xl bg-opacity-20 ${color} text-text`}><Icon className="w-5 h-5" /></div>
            <div>
                <p className="text-muted text-klein font-bold uppercase tracking-wider">{label}</p>
                <h3 className="text-xl font-bold text-text">{value}</h3>
            </div>
        </div>
    </div>
);

// Turn a {key: count} map into a sorted [{label, value}] list, optionally capped to top N.
function toSorted(map, topN) {
    const arr = Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return topN ? arr.slice(0, topN) : arr;
}

export default function Statistics() {
    const [cards, setCards] = useState([]);

    useEffect(() => {
        if (window.api) window.api.getCollection().then(c => setCards(c || []));
    }, []);

    const s = useMemo(() => {
        const qty = c => c.quantity || 1;
        const byType = {}, byAttr = {}, byRace = {}, byRarity = {}, byLevel = {}, byLang = {}, bySet = {};
        let totalCards = 0, totalValue = 0;

        cards.forEach(c => {
            const q = qty(c);
            totalCards += q;
            totalValue += c.value != null ? c.value : (c.price || 0) * q;

            const type = c.type?.includes('Monster') ? 'Monster'
                       : c.type?.includes('Spell') ? 'Spell'
                       : c.type?.includes('Trap') ? 'Trap' : 'Other';
            byType[type] = (byType[type] || 0) + q;

            const isMonster = type === 'Monster';
            if (isMonster) {
                if (c.attribute) byAttr[c.attribute] = (byAttr[c.attribute] || 0) + q;
                if (c.race) byRace[c.race] = (byRace[c.race] || 0) + q;
                if (c.level != null) {
                    const key = `Lvl/Rk ${c.level}`;
                    byLevel[key] = (byLevel[key] || 0) + q;
                }
            }
            byRarity[c.rarity || 'Unknown'] = (byRarity[c.rarity || 'Unknown'] || 0) + q;
            byLang[c.language || 'DE'] = (byLang[c.language || 'DE'] || 0) + q;
            const setPrefix = c.set_code ? c.set_code.split('-')[0] : 'Unknown';
            bySet[setPrefix] = (bySet[setPrefix] || 0) + q;
        });

        const topValued = cards
            .map(c => ({ ...c, equity: c.value != null ? c.value : (c.price || 0) * qty(c) }))
            .sort((a, b) => b.equity - a.equity)
            .slice(0, 5);

        // Level distribution sorted by numeric level, not count.
        const levelSorted = Object.entries(byLevel)
            .map(([label, value]) => ({ label, value, n: parseInt(label.replace(/\D/g, ''), 10) }))
            .sort((a, b) => a.n - b.n);

        return {
            totalCards,
            uniqueCards: cards.length,
            totalValue,
            avgValue: totalCards > 0 ? totalValue / totalCards : 0,
            distinctSets: Object.keys(bySet).length,
            distinctRarities: Object.keys(byRarity).length,
            byType: toSorted(byType),
            byAttr: toSorted(byAttr),
            byRace: toSorted(byRace, 10),
            byRarity: toSorted(byRarity),
            byLevel: levelSorted,
            byLang: toSorted(byLang),
            bySet: toSorted(bySet, 10),
            topValued,
        };
    }, [cards]);

    const money = v => `€${(v || 0).toFixed(2)}`;

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-3xl font-bold text-text flex items-center gap-3">
                <BarChart3 className="w-7 h-7 text-muted" /> Collection Statistics
            </h1>

            {cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted border-2 border-dashed border-line rounded-xl bg-bg/50">
                    <p className="text-lg font-medium">No cards yet</p>
                    <p className="text-sm mt-2 opacity-60">Statistics will appear once your collection has cards.</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <Tile icon={Library} label="Total Cards" value={s.totalCards} />
                        <Tile icon={Layers} label="Unique" value={s.uniqueCards} />
                        <Tile icon={DollarSign} label="Total Value" value={money(s.totalValue)} />
                        <Tile icon={DollarSign} label="Avg / Card" value={money(s.avgValue)} />
                        <Tile icon={Package} label="Sets" value={s.distinctSets} />
                        <Tile icon={Sparkles} label="Rarities" value={s.distinctRarities} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <BarStat title="Card Types" data={s.byType} />
                        <BarStat title="Attributes" data={s.byAttr} />
                        <BarStat title="Rarities" data={s.byRarity} />
                        <BarStat title="Monster Types (Top 10)" data={s.byRace} />
                        <BarStat title="Levels / Ranks" data={s.byLevel} />
                        <BarStat title="Languages" data={s.byLang} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <BarStat title="Top Sets (by cards owned)" data={s.bySet} />
                        <div className="bg-surface rounded-2xl border border-line p-6">
                            <h3 className="text-sm font-bold text-muted uppercase tracking-wider mb-4 flex items-center">
                                <DollarSign className="w-4 h-4 mr-2" /> Most Valuable Cards
                            </h3>
                            <div className="space-y-2">
                                {s.topValued.map(c => (
                                    <div key={c.id + c.set_code + c.language} className="flex items-center gap-3">
                                        <div className="w-8 h-12 bg-bg rounded overflow-hidden flex-shrink-0 border border-line">
                                            {c.image_url && <img src={c.image_url} alt="" className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-text text-sm truncate">{c.name}</div>
                                            <div className="text-xs text-muted font-mono">{c.set_code} • {c.rarity} • x{c.quantity || 1}</div>
                                        </div>
                                        <div className="text-right font-bold text-text">{money(c.equity)}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
