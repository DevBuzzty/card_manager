import { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, DollarSign, Clock, Layers, RefreshCw } from 'lucide-react';

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
            setHistory(hist.map(h => ({
                timestamp: h.timestamp,
                value: h.total_value
            })));
        }

        setStats(portfolio);

        // Process Top Assets (Equity = Price * Quantity)
        const assets = collection
            .map(c => ({ ...c, equity: (c.price || 0) * (c.quantity || 1) }))
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
            typeMap[type] += (c.price || 0) * (c.quantity || 1);
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

            return () => {
                if (cleanup) cleanup();
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

    const COLORS = ['#9D00FF', '#00C49F', '#FFBB28', '#FF8042'];

    return (
        <div className="max-w-7xl mx-auto h-full flex flex-col gap-6 p-2">
            {/* Header / Main Value */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                <div>
                    <div className="flex items-center gap-3">
                         <span className="text-gray-500 text-sm uppercase font-bold tracking-widest">Total Portfolio Value</span>
                         {isLive && (
                             <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 text-[10px] uppercase font-bold tracking-wider animate-pulse border border-red-500/50">
                                 Live Update
                             </span>
                         )}
                         <button
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="p-1 hover:bg-white/10 rounded-full transition-colors text-gray-500 hover:text-white"
                            title="Refresh Prices"
                         >
                             <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                         </button>
                    </div>
                    <h1 className={`text-6xl font-bold text-white mt-2 tracking-tight transition-colors duration-500 ${isLive ? 'text-green-400' : ''}`}>
                        ${stats.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </h1>
                    <div className={`flex items-center mt-2 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                        {isPositive ? <TrendingUp className="w-5 h-5 mr-2" /> : <TrendingDown className="w-5 h-5 mr-2" />}
                        <span className="text-lg font-mono font-medium">
                            {isPositive ? '+' : ''}{absoluteChange.toFixed(2)} ({percentChange.toFixed(2)}%)
                        </span>
                        <span className="text-gray-600 text-sm ml-2 uppercase font-bold">{timeframe === 'ALL' ? 'All Time' : 'Past ' + timeframe}</span>
                    </div>
                </div>

                <div className="flex bg-[#1E1E1E] rounded-lg p-1 border border-gray-800">
                    {['1W', '1M', '1Y', 'ALL'].map(tf => (
                        <button
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${timeframe === tf ? 'bg-space-violet text-white shadow-lg' : 'text-gray-500 hover:text-white'}`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Chart */}
            <div className="h-80 bg-[#1E1E1E] rounded-2xl border border-gray-800 p-6 shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-b from-space-violet/5 to-transparent pointer-events-none"></div>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={filteredHistory}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#9D00FF" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#9D00FF" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <Tooltip
                            contentStyle={{ backgroundColor: '#121212', borderColor: '#333', borderRadius: '8px' }}
                            itemStyle={{ color: '#fff' }}
                            labelStyle={{ color: '#888' }}
                            formatter={(value) => [`$${value.toFixed(2)}`, 'Value']}
                            labelFormatter={(label) => new Date(label).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="#9D00FF"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorValue)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                {/* Top Assets */}
                <div className="lg:col-span-2 bg-[#1E1E1E] rounded-2xl border border-gray-800 flex flex-col overflow-hidden">
                    <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-[#252525]">
                        <h3 className="text-xl font-bold text-white flex items-center">
                            <ArrowUpRight className="w-5 h-5 mr-2 text-space-violet" />
                            Top Performers
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                        {topAssets.length === 0 && <div className="p-8 text-center text-gray-500">No assets found.</div>}
                        <table className="w-full text-left text-sm">
                            <thead className="text-xs uppercase text-gray-500 font-medium">
                                <tr>
                                    <th className="px-4 py-3">Asset</th>
                                    <th className="px-4 py-3 text-right">Price</th>
                                    <th className="px-4 py-3 text-right">Qty</th>
                                    <th className="px-4 py-3 text-right">Equity</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {topAssets.map(asset => (
                                    <tr key={asset.id + asset.set_code} className="hover:bg-white/5 transition-colors group">
                                        <td className="px-4 py-3 flex items-center gap-3">
                                            <div className="w-8 h-12 bg-black rounded overflow-hidden flex-shrink-0 border border-gray-700">
                                                <img src={asset.image_url} alt="" className="w-full h-full object-cover" />
                                            </div>
                                            <div>
                                                <div className="font-bold text-white">{asset.name}</div>
                                                <div className="text-xs text-gray-500 font-mono">{asset.set_code} • {asset.rarity}</div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-gray-300">${asset.price.toFixed(2)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-gray-500">x{asset.quantity}</td>
                                        <td className="px-4 py-3 text-right font-bold text-white group-hover:text-space-violet transition-colors">
                                            ${asset.equity.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Allocation / Stats */}
                <div className="flex flex-col gap-6">
                    <div className="bg-[#1E1E1E] rounded-2xl border border-gray-800 p-6 flex-1 flex flex-col">
                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
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
                                    <Tooltip contentStyle={{ backgroundColor: '#121212', borderRadius: '8px', border: '1px solid #333' }} itemStyle={{color: '#fff'}} formatter={(value) => `$${value.toFixed(2)}`} />
                                </PieChart>
                            </ResponsiveContainer>
                            {/* Center Text */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="text-center">
                                    <span className="block text-2xl font-bold text-white">{stats.totalCards}</span>
                                    <span className="text-[10px] uppercase text-gray-500 font-bold">Cards</span>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 space-y-2">
                            {allocation.map((item, idx) => (
                                <div key={item.name} className="flex justify-between items-center text-xs">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                                        <span className="text-gray-300">{item.name}</span>
                                    </div>
                                    <span className="font-mono text-gray-500">${item.value.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
