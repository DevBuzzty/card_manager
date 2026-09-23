import { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, DollarSign, Clock, Layers, RefreshCw } from 'lucide-react';
import { fmtEUR, fmtSignedEUR, fmtNum } from '../utils/format';

export default function Portfolio() {
    const [history, setHistory] = useState([]);
    const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
    const [topAssets, setTopAssets] = useState([]);
    const [timeframe, setTimeframe] = useState('ALL');
    const [allocation, setAllocation] = useState([]);
    const [isLive, setIsLive] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const loadData = async () => {
        if (!window.api) return;
        const hist = await window.api.getPriceHistory();
        const portfolio = await window.api.getPortfolio();
        const collection = await window.api.getCollection();

        // Process History
        // If history is empty, use current value as a single point
        if (!hist || hist.length === 0) {
            setHistory([{ timestamp: new Date().toISOString(), value: portfolio.totalValue }]);
        } else {
            setHistory(hist.map(h => {
                // Ensure timestamp is valid string. SQL timestamp might be "YYYY-MM-DD HH:MM:SS" which needs "T" and "Z" for robust JS parsing
                let validTs = h.timestamp;
                if (validTs && !validTs.includes('T')) {
                    validTs = validTs.replace(' ', 'T') + 'Z';
                }
                return {
                    timestamp: validTs,
                    value: h.total_value
                };
            }).filter(h => {
                const d = new Date(h.timestamp);
                return !isNaN(d.getTime()) && d.getFullYear() > 1980; // Filter out epoch defaults
            }));
        }

        setStats(portfolio);

        // Process Top Assets (Equity = Price * Quantity)
        const assets = collection
            .map(c => ({ ...c, equity: c.value != null ? c.value : (c.price || 0) * (c.quantity || 1) }))
            .sort((a, b) => b.equity - a.equity)
            .slice(0, 100);
        setTopAssets(assets);

        // Process Allocation (by Type)
        const typeMap = {};
        collection.forEach(c => {
            const type = c.type?.includes('Monster') ? 'Monster'
                       : c.type?.includes('Spell') ? 'Spell'
                       : c.type?.includes('Trap') ? 'Trap'
                       : 'Other';
            if (!typeMap[type]) typeMap[type] = 0;
            typeMap[type] += c.value != null ? c.value : (c.price || 0) * (c.quantity || 1);
        });

        const allocData = Object.keys(typeMap).map(k => ({ name: k, value: typeMap[k] }));
        setAllocation(allocData);
    };

    useEffect(() => {
        if (window.api) {
            // Use setTimeout to avoid synchronous state update warning
            setTimeout(() => loadData(), 0);

            // Listen for real-time price updates
            const cleanup = window.api.onPriceUpdate && window.api.onPriceUpdate((data) => {
                console.log("Price Update Received:", data);
                setIsLive(true);
                // We could selectively update state, but reloading ensures consistency for now
                // Optimization: just update stats and history if needed, but loadData is fast enough locally
                setTimeout(() => loadData(), 0);

                // Pulse effect timeout
                setTimeout(() => setIsLive(false), 2000);
            });

            // Reload when the sync cycle pulls changes from the phone
            const cleanupSync = window.api.onCollectionChanged && window.api.onCollectionChanged(() => {
                setTimeout(() => loadData(), 0);
            });

            // Spec G3: Sealed-Änderungen ändern den Gesamtwert
            const cleanupSealed = window.api.onSealedChanged && window.api.onSealedChanged(() => {
                setTimeout(() => loadData(), 0);
            });

            return () => {
                if (cleanup) cleanup();
                if (cleanupSync) cleanupSync();
                if (cleanupSealed) cleanupSealed();
            }
        }
    }, []);

    const filteredHistory = useMemo(() => {
        if (timeframe === 'ALL') return history;
        const now = new Date();
        const cutoff = new Date();

        if (timeframe === '1W') cutoff.setDate(now.getDate() - 7);
        if (timeframe === '1M') cutoff.setMonth(now.getMonth() - 1);
        if (timeframe === '1Y') cutoff.setFullYear(now.getFullYear() - 1);

        return history.filter(h => new Date(h.timestamp) >= cutoff);
    }, [history, timeframe]);

    // Calculate Change
    const startValue = filteredHistory.length > 0 ? filteredHistory[0].value : 0;
    const currentValue = stats.totalValue;
    const absoluteChange = currentValue - startValue;
    const percentChange = startValue > 0 ? (absoluteChange / startValue) * 100 : 0;
    const isPositive = absoluteChange >= 0;

    const handleRefresh = async () => {
        setIsRefreshing(true);
        if (window.api) {
            await window.api.updateAllCards();
            loadData();
        }
        setIsRefreshing(false);
    };

    const COLORS = ['var(--accent)', '#00C49F', '#FFBB28', '#FF8042'];

    return (
        <div className="max-w-7xl mx-auto h-full flex flex-col gap-6 p-2">
            {/* Header / Main Value */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                <div>
                    <div className="flex items-center gap-3">
                         <span className="text-muted text-sm uppercase font-bold tracking-widest">Total Portfolio Value</span>
                         {isLive && (
                             <span className="px-2 py-0.5 rounded-full bg-accent/20 text-text text-[10px] uppercase font-bold tracking-wider animate-pulse border border-accent/50">
                                 Live Update
                             </span>
                         )}
                         <button
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="p-1 hover:bg-surface-2 rounded-full transition-colors text-muted hover:text-text"
                            title="Refresh Prices"
                         >
                             <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                         </button>
                    </div>
                    <h1 className={`text-6xl font-bold text-text mt-2 tracking-tight transition-colors duration-500 ${isLive ? 'text-accent' : ''}`}>
                        {fmtEUR(stats.totalValue)}
                    </h1>
                    <div className={`flex items-center mt-2 ${isPositive ? 'text-good' : 'text-bad'}`}>
                        {isPositive ? <TrendingUp className="w-5 h-5 mr-2" /> : <TrendingDown className="w-5 h-5 mr-2" />}
                        <span className="text-lg font-mono font-medium">
                            {fmtSignedEUR(absoluteChange)} ({fmtNum(percentChange)}%)
                        </span>
                        <span className="text-muted text-sm ml-2 uppercase font-bold">{timeframe === 'ALL' ? 'All Time' : 'Past ' + timeframe}</span>
                    </div>
                </div>

                <div className="flex bg-surface rounded-lg p-1 border border-line">
                    {['1W', '1M', '1Y', 'ALL'].map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${timeframe === tf ? 'bg-accent text-accent-fg' : 'text-muted hover:text-accent'}`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Chart */}
            <div className="h-80 bg-surface rounded-2xl border border-line p-6 shadow-2xl relative overflow-hidden group">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={filteredHistory}>
                        {/* Hidden axis: gives the tooltip the real timestamp as its label (without it, label defaults to the point index → 1970 dates) */}
                        <XAxis dataKey="timestamp" hide />
                        <Tooltip
                            contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)', borderRadius: '8px' }}
                            itemStyle={{ color: 'var(--text)' }}
                            labelStyle={{ color: 'var(--text-muted)' }}
                            formatter={(value) => [fmtEUR(value), 'Value']}
                            labelFormatter={(label) => new Date(label).toLocaleDateString('de-DE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="var(--accent)"
                            strokeWidth={3}
                            fillOpacity={0.15}
                            fill="var(--accent)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Top Assets */}
                <div className="lg:col-span-2 bg-surface rounded-2xl border border-line flex flex-col overflow-hidden">
                    <div className="p-6 border-b border-line flex justify-between items-center bg-surface-2">
                        <h3 className="text-xl font-bold text-text flex items-center">
                            <ArrowUpRight className="w-5 h-5 mr-2 text-accent" />
                            Wertvollste Bestände
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                        {topAssets.length === 0 && <div className="p-8 text-center text-muted">No assets found.</div>}
                        <table className="w-full text-left text-sm">
                            <thead className="text-xs uppercase text-muted font-medium">
                                <tr>
                                    <th className="px-4 py-3">Asset</th>
                                    <th className="px-4 py-3 text-right">Price</th>
                                    <th className="px-4 py-3 text-right">Qty</th>
                                    <th className="px-4 py-3 text-right">Equity</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                                {topAssets.map(asset => (
                                    <tr key={asset.id + asset.set_code} className="hover:bg-surface-2 transition-colors group">
                                        <td className="px-4 py-3 flex items-center gap-3">
                                            <div className="w-8 h-12 bg-bg rounded overflow-hidden flex-shrink-0 border border-line">
                                                <img src={asset.image_url} alt="" className="w-full h-full object-cover" />
                                            </div>
                                            <div>
                                                <div className="font-bold text-text">{asset.name}</div>
                                                <div className="text-xs text-muted font-mono">{asset.set_code} • {asset.rarity}</div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-text">{fmtEUR(asset.price)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-muted">x{asset.quantity}</td>
                                        <td className="px-4 py-3 text-right font-bold text-text group-hover:text-accent transition-colors">
                                            {fmtEUR(asset.equity)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Allocation / Stats */}
                <div className="flex flex-col gap-6">
                    <div className="bg-surface rounded-2xl border border-line p-6 flex-1 flex flex-col">
                        <h3 className="text-sm font-bold text-muted uppercase tracking-wider mb-4 flex items-center">
                            <Layers className="w-4 h-4 mr-2" /> Allocation
                        </h3>
                        <div className="flex-1 min-h-[200px] relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={allocation}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {allocation.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--line)' }} itemStyle={{color: 'var(--text)'}} formatter={(value) => fmtEUR(value)} />
                                </PieChart>
                            </ResponsiveContainer>
                            {/* Center Text */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-center">
                                    <span className="block text-2xl font-bold text-text">{stats.totalCards}</span>
                                    <span className="text-[10px] uppercase text-muted font-bold">Cards</span>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 space-y-2">
                            {allocation.map((item, idx) => (
                                <div key={item.name} className="flex justify-between items-center text-xs">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                                        <span className="text-text">{item.name}</span>
                                    </div>
                                    <span className="font-mono text-text">{fmtEUR(item.value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
