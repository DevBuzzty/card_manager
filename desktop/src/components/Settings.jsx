import { useState, useEffect } from 'react';
import { Database, FileUp, Download, RefreshCw, Layers } from 'lucide-react';

export default function Settings() {
    const [priceSource, setPriceSource] = useState('cardmarket');

    useEffect(() => {
        if (window.api) {
            window.api.getSettings().then(settings => {
                if (settings.price_source) setPriceSource(settings.price_source);
            });
        }
    }, []);

    const handleSave = async (key, value) => {
        if (window.api) {
            await window.api.saveSetting({ key, value });
        }
    };

    const handleBackup = async () => {
        if (window.api) {
            const res = await window.api.backupDatabase();
            if (res.success) alert("Backup saved successfully!");
            else if (!res.canceled) alert("Backup failed: " + res.error);
        }
    };

    const handleRestore = async () => {
        if (confirm("Restoring will overwrite your current database and restart the app. Continue?")) {
            if (window.api) {
                const res = await window.api.restoreDatabase();
                if (!res.success && !res.canceled) alert("Restore failed: " + res.error);
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h2 className="text-3xl font-bold text-space-white mb-8">Settings</h2>

            <div className="grid gap-6">
                {/* Data Management Section */}
                <div className="bg-[#1E1E1E] p-6 rounded-xl border border-gray-800">
                    <div className="flex items-center mb-4 text-space-violet">
                        <Database className="w-5 h-5 mr-2" />
                        <h3 className="text-xl font-bold">Data Management</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 hover:border-space-violet/50 transition-colors">
                            <h4 className="font-bold text-gray-300 mb-2">Backup Collection</h4>
                            <p className="text-sm text-gray-500 mb-4">Save your entire collection and decks to a file.</p>
                            <button
                                onClick={handleBackup}
                                className="w-full flex items-center justify-center px-4 py-2 bg-gray-800 hover:bg-space-violet text-gray-300 hover:text-white rounded-lg transition-colors border border-gray-700"
                            >
                                <Download className="w-4 h-4 mr-2" />
                                Export Backup
                            </button>
                        </div>

                        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 hover:border-red-500/30 transition-colors">
                            <h4 className="font-bold text-gray-300 mb-2">Restore Backup</h4>
                            <p className="text-sm text-gray-500 mb-4">Restore from a previous backup file (Requires Restart).</p>
                            <button
                                onClick={handleRestore}
                                className="w-full flex items-center justify-center px-4 py-2 bg-gray-800 hover:bg-red-900/50 text-gray-300 hover:text-white rounded-lg transition-colors border border-gray-700"
                            >
                                <FileUp className="w-4 h-4 mr-2" />
                                Import Backup
                            </button>
                        </div>
                    </div>
                </div>

                {/* API & Pricing Section */}
                <div className="bg-[#1E1E1E] p-6 rounded-xl border border-gray-800">
                    <div className="flex items-center mb-4 text-green-400">
                        <RefreshCw className="w-5 h-5 mr-2" />
                        <h3 className="text-xl font-bold">Pricing Source</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                        <div>
                            <p className="text-gray-400 mb-2">Select the market source for card prices:</p>
                            <select
                                value={priceSource}
                                onChange={(e) => {
                                    setPriceSource(e.target.value);
                                    handleSave('price_source', e.target.value);
                                }}
                                className="w-full bg-[#1a1a1a] border border-gray-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:border-space-violet"
                            >
                                <option value="cardmarket">CardMarket (EU)</option>
                                <option value="tcgplayer">TCGPlayer (US)</option>
                                <option value="ebay">eBay</option>
                                <option value="amazon">Amazon</option>
                                <option value="coolstuffinc">CoolStuffInc</option>
                            </select>
                        </div>
                        <div className="text-sm text-gray-500 bg-black/20 p-3 rounded border border-gray-800">
                            Note: Prices are updated via the "Refresh" button in the Collection tab. Changes here apply to future updates.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
