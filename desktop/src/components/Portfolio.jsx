import { useState, useEffect } from 'react';
import { TrendingUp, Coins, Layers } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Portfolio() {
  const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (window.api) {
        window.api.getPortfolio().then(setStats);
        window.api.getPriceHistory().then(data => {
            // Format timestamp slightly
            const formatted = data.map(d => ({
                ...d,
                date: new Date(d.timestamp).toLocaleDateString()
            }));
            setHistory(formatted);
        });
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
        <h2 className="text-3xl font-bold text-space-white mb-6">Portfolio Dashboard</h2>

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
    </div>
  );
}
