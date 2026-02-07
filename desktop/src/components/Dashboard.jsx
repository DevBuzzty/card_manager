import { useState, useEffect } from 'react';
import { TrendingUp, Library, Layers, Clock, ArrowRight } from 'lucide-react';

export default function Dashboard({ setActiveTab }) {
    const [stats, setStats] = useState({ totalValue: 0, totalCards: 0, uniqueCards: 0 });
    const [recentCards, setRecentCards] = useState([]);

    useEffect(() => {
        if (window.api) {
            window.api.getPortfolio().then(data => setStats(data || { totalValue: 0, totalCards: 0, uniqueCards: 0 }));
            window.api.getCollection().then(cards => {
                setRecentCards((cards || []).slice(0, 5));
            });
        }
    }, []);

    const StatCard = ({ icon: Icon, label, value, color, onClick }) => (
        <div
            onClick={onClick}
            className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 hover:border-space-violet/50 transition-all cursor-pointer group relative overflow-hidden"
        >
            <div className={`absolute right-[-20px] top-[-20px] w-24 h-24 rounded-full opacity-10 ${color}`}></div>
            <div className="flex items-center gap-4 relative z-10">
                <div className={`p-3 rounded-xl bg-opacity-20 ${color} text-white`}>
                    <Icon className="w-6 h-6" />
                </div>
                <div>
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">{label}</p>
                    <h3 className="text-2xl font-bold text-white">{value}</h3>
                </div>
            </div>
            <ArrowRight className="absolute bottom-4 right-4 w-4 h-4 text-gray-600 group-hover:text-space-violet transition-colors" />
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-4xl font-bold text-white mb-2">Welcome Back</h1>
                    <p className="text-gray-400">Here's what's happening with your collection.</p>
                </div>
                <button
                    onClick={() => setActiveTab('staging')}
                    className="px-6 py-3 bg-space-violet hover:bg-space-violet-dark text-white rounded-xl font-bold shadow-lg shadow-space-violet/20 transition-all hover:scale-105"
                >
                    Start Scanning
                </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    icon={TrendingUp}
                    label="Portfolio Value"
                    value={`$${(stats.totalValue || 0).toFixed(2)}`}
                    color="bg-space-violet"
                    onClick={() => setActiveTab('portfolio')}
                />
                <StatCard
                    icon={Library}
                    label="Total Cards"
                    value={stats.totalCards || 0}
                    color="bg-blue-500"
                    onClick={() => setActiveTab('collection')}
                />
                <StatCard
                    icon={Layers}
                    label="Unique Items"
                    value={stats.uniqueCards || 0}
                    color="bg-green-500"
                    onClick={() => setActiveTab('collection')}
                />
            </div>

            {/* Recent Activity */}
            <div className="bg-[#1E1E1E] rounded-2xl border border-gray-800 overflow-hidden">
                <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Clock className="w-5 h-5 text-gray-400" />
                        Recently Added
                    </h3>
                    <button onClick={() => setActiveTab('collection')} className="text-sm text-space-violet hover:underline">View All</button>
                </div>
                <div className="divide-y divide-gray-800">
                    {recentCards.length === 0 && (
                        <div className="p-8 text-center text-gray-500">No cards in collection yet.</div>
                    )}
                    {recentCards.map((card, idx) => (
                        <div key={card.id + card.set_code + idx} className="p-4 flex items-center gap-4 hover:bg-black/20 transition-colors">
                            <img src={card.image_url} alt="" className="w-10 h-14 object-cover rounded shadow-sm" />
                            <div className="flex-1">
                                <h4 className="font-bold text-white">{card.name}</h4>
                                <p className="text-xs text-gray-500">{card.set_code} • {card.rarity}</p>
                            </div>
                            <div className="text-right font-mono text-space-violet font-bold">${(card.price || 0).toFixed(2)}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
