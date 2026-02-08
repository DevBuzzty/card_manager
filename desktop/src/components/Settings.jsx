import { useState, useEffect } from 'react';
import { Database, FileUp, Download, RefreshCw, Trash2, DollarSign } from 'lucide-react';

export default function Settings() {
    const [priceSource, setPriceSource] = useState('cardmarket');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (window.api) {
            window.api.getSettings().then(settings => {
                if (settings && settings.price_source) {
                    setPriceSource(settings.price_source);
                }
            });
        }
    }, []);

    const handleSaveSource = async (e) => {
        const newSource = e.target.value;
        setPriceSource(newSource);
        if (window.api) {
            await window.api.saveSetting({ key: 'price_source', value: newSource });
        }
    };

    const handleUpdatePrices = async () => {
        if (loading) return;
        if (!confirm(`Update ALL card prices using ${priceSource}? This may take a while.`)) return;

        setLoading(true);
        if (window.api) {
            // This triggers the full update logic in main.cjs, which reads the new setting
            const res = await window.api.updateAllCards();
            if (res.success) {
                alert(`Successfully updated prices for ${res.updatedCount} cards.`);
            } else {
                alert("Update failed: " + res.error);
            }
        }
        setLoading(false);
    };

    const handleBackup = async () => {
        if (window.api) {
            const res = await window.api.backupDatabase();
            if (res.success) alert("Backup saved successfully!");
            else if (res.error) alert("Backup failed: " + res.error);
        }
    };

    const handleRestore = async () => {
        if (confirm("Restoring will overwrite your current database and restart the app. Continue?")) {
            if (window.api) {
                const res = await window.api.restoreDatabase();
                if (res.error) alert("Restore failed: " + res.error);
            }
        }
    };

    const handleReset = async () => {
        if (confirm("DANGER: This will permanently delete your ENTIRE collection and all decks. This cannot be undone. Are you absolutely sure?")) {
            if (window.api) {
                const res = await window.api.resetDatabase();
                if (!res.success) alert("Reset failed: " + res.error);
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-3xl font-bold text-white mb-2">Settings</h2>
                <p className="text-gray-400">Manage your data and application preferences.</p>
            </div>

            <div className="grid gap-6">
                {/* API & Pricing Section */}
                <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-xl">
                    <div className="flex items-center mb-6 text-space-violet border-b border-gray-800 pb-4">
                        <DollarSign className="w-6 h-6 mr-2" />
                        <h3 className="text-xl font-bold text-white">Market Data</h3>
                    </div>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Price Source</label>
                                <select
                                    value={priceSource}
                                    onChange={handleSaveSource}
                                    className="w-full bg-black/40 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-space-violet transition-colors cursor-pointer appearance-none"
                                >
                                    <option value="cardmarket">CardMarket (Europe)</option>
                                    <option value="tcgplayer">TCGPlayer (North America)</option>
                                    <option value="ebay">eBay</option>
                                    <option value="amazon">Amazon</option>
                                    <option value="coolstuffinc">CoolStuffInc</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-2">
                                    Determines which market data is used for portfolio valuation and card details.
                                </p>
                            </div>

                            <div className="flex items-end">
                                <button
                                    onClick={handleUpdatePrices}
                                    disabled={loading}
                                    className="w-full flex items-center justify-center px-6 py-3 bg-space-violet hover:bg-space-violet-dark text-white rounded-xl font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-space-violet/20"
                                >
                                    <RefreshCw className={`w-5 h-5 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                    {loading ? 'Updating Prices...' : 'Force Price Update'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Data Management Section */}
                <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-xl">
                    <div className="flex items-center mb-6 text-blue-400 border-b border-gray-800 pb-4">
                        <Database className="w-6 h-6 mr-2" />
                        <h3 className="text-xl font-bold text-white">Data Management</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            onClick={handleBackup}
                            className="p-4 bg-gray-900/50 hover:bg-gray-800 rounded-xl border border-gray-700 hover:border-blue-400/50 transition-all text-left group"
                        >
                            <div className="flex items-center text-blue-400 mb-2">
                                <Download className="w-5 h-5 mr-2" />
                                <h4 className="font-bold">Backup Database</h4>
                            </div>
                            <p className="text-sm text-gray-500 group-hover:text-gray-400">Save your entire collection and decks to a local file.</p>
                        </button>

                        <button
                            onClick={handleRestore}
                            className="p-4 bg-gray-900/50 hover:bg-gray-800 rounded-xl border border-gray-700 hover:border-green-400/50 transition-all text-left group"
                        >
                            <div className="flex items-center text-green-400 mb-2">
                                <FileUp className="w-5 h-5 mr-2" />
                                <h4 className="font-bold">Restore Backup</h4>
                            </div>
                            <p className="text-sm text-gray-500 group-hover:text-gray-400">Restore from a previous backup file (Requires Restart).</p>
                        </button>

                        <button
                            onClick={handleReset}
                            className="col-span-1 md:col-span-2 p-4 bg-red-900/10 hover:bg-red-900/20 rounded-xl border border-red-900/30 hover:border-red-500/50 transition-all text-left group mt-4"
                        >
                            <div className="flex items-center text-red-500 mb-2">
                                <Trash2 className="w-5 h-5 mr-2" />
                                <h4 className="font-bold">Factory Reset</h4>
                            </div>
                            <p className="text-sm text-red-400/60 group-hover:text-red-400">Permanently delete all data and start fresh. This action cannot be undone.</p>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
