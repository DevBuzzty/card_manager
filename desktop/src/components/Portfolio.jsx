import { useState, useEffect } from 'react';
import { TrendingUp, Coins, Layers, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Portfolio() {
  const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
  const [history, setHistory] = useState([]);
  const [cards, setCards] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = () => {
    if (window.api) {
        window.api.getPortfolio().then(setStats);
        window.api.getCollection().then(data => {
            // Sort by price descending by default
            setCards(data.sort((a, b) => (b.price || 0) - (a.price || 0)));
        });
        window.api.getPriceHistory().then(data => {
            const formatted = data.map(d => ({
                ...d,
                date: new Date(d.timestamp).toLocaleDateString()
            }));
            setHistory(formatted);
        });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefreshPrices = async () => {
      if (isRefreshing || !window.api) return;
      setIsRefreshing(true);
      try {
          await window.api.updateAllCards(); // This updates prices and history
          loadData();
      } catch (e) {
          console.error(e);
      } finally {
          setIsRefreshing(false);
      }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-3xl font-bold text-space-white">Portfolio Dashboard</h2>
            <button
                onClick={handleRefreshPrices}
                disabled={isRefreshing}
                className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors shadow-lg disabled:opacity-50"
            >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh Market Values
            </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-lg relative overflow-hidden group">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-space-violet/10 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex items-center gap-4 relative z-10">
                    <div className="p-3 bg-space-violet/20 rounded-xl text-space-violet">
                        <TrendingUp className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-gray-400 text-sm font-medium uppercase tracking-wider">Total Value</p>
                        <h3 className="text-3xl font-bold text-white">${stats.totalValue?.toFixed(2) || '0.00'}</h3>
                    </div>
                </div>
            </div>

            <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-lg relative overflow-hidden group">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-500/10 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex items-center gap-4 relative z-10">
                    <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">
                        <Coins className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-gray-400 text-sm font-medium uppercase tracking-wider">Total Cards</p>
                        <h3 className="text-3xl font-bold text-white">{stats.totalCards || 0}</h3>
                    </div>
                </div>
            </div>

            <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-lg relative overflow-hidden group">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-green-500/10 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex items-center gap-4 relative z-10">
                    <div className="p-3 bg-green-500/20 rounded-xl text-green-400">
                        <Layers className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-gray-400 text-sm font-medium uppercase tracking-wider">Unique Items</p>
                        <h3 className="text-3xl font-bold text-white">{stats.uniqueCards || 0}</h3>
                    </div>
                </div>
            </div>
        </div>

        {/* Chart */}
        <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-lg">
            <h3 className="text-xl font-bold text-gray-200 mb-6">Value History</h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="date" stroke="#666" tick={{fill: '#888'}} />
                        <YAxis stroke="#666" tick={{fill: '#888'}} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <Line type="monotone" dataKey="total_value" stroke="#9D00FF" strokeWidth={3} dot={{r: 4, fill: '#9D00FF'}} activeDot={{r: 6}} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>

        {/* Detailed List */}
        <div className="bg-[#1E1E1E] rounded-2xl border border-gray-800 overflow-hidden shadow-lg">
            <div className="p-6 border-b border-gray-800">
                <h3 className="text-xl font-bold text-gray-200">Asset Breakdown</h3>
            </div>
            <table className="w-full text-left text-sm text-gray-400">
                <thead className="bg-black/50 text-xs uppercase text-gray-500">
                    <tr>
                        <th className="px-6 py-4 font-medium">Card Name</th>
                        <th className="px-6 py-4 font-medium">Rarity / Set</th>
                        <th className="px-6 py-4 font-medium text-center">Qty</th>
                        <th className="px-6 py-4 font-medium text-right">Unit Price</th>
                        <th className="px-6 py-4 font-medium text-right">Total Value</th>
                        <th className="px-6 py-4 font-medium text-right">24h Change</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {cards.map(card => {
                        const total = (card.price || 0) * (card.quantity || 1);
                        // Mock fluctuation for now since we just started tracking
                        const fluctuation = Math.random() * 10 - 5;
                        const isPositive = fluctuation >= 0;

                        return (
                            <tr key={`${card.id}-${card.set_code}`} className="hover:bg-gray-800/50 transition-colors">
                                <td className="px-6 py-4 text-white font-medium flex items-center gap-3">
                                    <div className="w-8 h-12 bg-black rounded overflow-hidden flex-shrink-0">
                                         <img src={card.image_url} className="w-full h-full object-cover" alt="" />
                                    </div>
                                    <div>
                                        <div>{card.name}</div>
                                        <div className="text-xs text-gray-500 font-mono">{card.id}</div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-xs text-gray-300">{card.set_code}</div>
                                    <div className="text-[10px] text-gray-500">{card.rarity}</div>
                                </td>
                                <td className="px-6 py-4 text-center font-mono text-white">{card.quantity}</td>
                                <td className="px-6 py-4 text-right font-mono">${(card.price || 0).toFixed(2)}</td>
                                <td className="px-6 py-4 text-right font-mono font-bold text-space-violet">${total.toFixed(2)}</td>
                                <td className={`px-6 py-4 text-right font-mono text-xs ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                                    <div className="flex items-center justify-end gap-1">
                                        {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                        {Math.abs(fluctuation).toFixed(2)}%
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
  );
}
