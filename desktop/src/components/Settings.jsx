import { useState, useEffect, useCallback } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Database, FileUp, Download, RefreshCw, Trash2, DollarSign, FolderInput, TrendingDown, Cloud, Layers, Cpu, UploadCloud } from 'lucide-react';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { KEEP_DEFAULT, keepPerCard } from '../utils/duplicates';
import { normalizeDiscount, normalizeMinPrice } from '../utils/saleMath';
import { T } from '../utils/i18n-de';
import { createBusyGate } from '../utils/busyGate';
import PriceAlertSettings from './PriceAlertSettings';
import ImportDialog from './ImportDialog';
import ExportDialog from './ExportDialog';
import EbaySettings from './EbaySettings';

const SECTIONS = [
    { id: 'konto', label: 'Konto & Sync' },
    { id: 'preise', label: 'Preise' },
    { id: 'ebay', label: 'eBay' },
    { id: 'verbindung', label: 'Verbindung' },
    { id: 'daten', label: 'Daten' },
    { id: 'standards', label: 'Standards' },
    { id: 'gefahrenzone', label: 'Gefahrenzone' },
];

export default function Settings() {
    const { bereich } = useParams();
    const active = bereich;
    const isKnownSection = SECTIONS.some(s => s.id === bereich);

    const [priceSource, setPriceSource] = useState('cardmarket');
    const [loading, setLoading] = useState(false);
    // Which long-running action owns `loading`/`progress` — the two sections that show a bar
    // ("preise" and "gefahrenzone") must only show their own. 'prices' | 'downgrade' | null.
    const [runningAction, setRunningAction] = useState(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [sync, setSync] = useState({ supabase_url: '', supabase_key: '', supabase_email: '', supabase_password: '', sync_enabled: 'false' });
    const [syncStatus, setSyncStatus] = useState(null);
    const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
    // Spec H1 §4: keep_per_card als Text im Eingabefeld; gespeichert wird der normalisierte Wert (ungültig -> 3).
    const [keepInput, setKeepInput] = useState(String(KEEP_DEFAULT));
    // Spec H2 §9: Preisvorschlag-Einstellungen, gleiche Bauart wie keepInput (Text im Feld, normalisiert beim Speichern).
    const [discountInput, setDiscountInput] = useState('5');
    const [minPriceInput, setMinPriceInput] = useState('0,10');
    const [ipAddress, setIpAddress] = useState('…');
    const [catalogStatus, setCatalogStatus] = useState({ lastRun: null, version: 0, bytes: 0 });
    const [catalogResult, setCatalogResult] = useState(null); // { ok, text }
    const [uploadingKind, setUploadingKind] = useState(null); // 'index' | 'embedder' | 'detector' | null
    const [modelResult, setModelResult] = useState(null); // { ok, text }
    const [importOpened, setImportOpened] = useState(null); // Spec F1: Antwort von importOpen() solange die Vorschau offen ist
    const [exportOpen, setExportOpen] = useState(false);

    useEffect(() => {
        if (window.api) {
            window.api.getSettings().then(settings => {
                if (settings && settings.price_source) {
                    setPriceSource(settings.price_source);
                }
                setSync(() => ({
                    supabase_url: settings?.supabase_url ?? '', supabase_key: settings?.supabase_key ?? '',
                    supabase_email: settings?.supabase_email ?? '', supabase_password: settings?.supabase_password ?? '',
                    sync_enabled: settings?.sync_enabled ?? 'false',
                }));
                setKeepInput(String(keepPerCard(settings?.keep_per_card)));
                setDiscountInput(String(normalizeDiscount(settings?.sale_discount_percent)));
                setMinPriceInput((normalizeMinPrice(settings?.sale_min_price) / 100).toFixed(2).replace('.', ','));
            });
            window.api.getDefaults?.().then(d => d && setDefaults(d));

            const cleanup = window.api.onUpdateProgress((data) => {
                setProgress(data);
            });
            const offStatus = window.api.onSyncStatus(setSyncStatus);
            return () => { cleanup(); offStatus(); };
        }
    }, []);

    useEffect(() => { window.api?.getIpAddress?.().then(setIpAddress); }, []);

    useEffect(() => { window.api?.getCatalogStatus?.().then(status => status && setCatalogStatus(status)); }, []);

    const formatBytes = (bytes) => {
        if (!bytes) return '0 Byte';
        const units = ['Byte', 'KB', 'MB', 'GB'];
        let n = bytes, i = 0;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return `${n.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${units[i]}`;
    };

    const saveSync = async (key, value) => {
        setSync(prev => ({ ...prev, [key]: value }));
        if (window.api) await window.api.saveSetting({ key, value });
    };

    const saveDefault = async (key, value) => {
        setDefaults(prev => ({ ...prev, [key]: value }));
        if (window.api) await window.api.saveSetting({ key: key === 'edition' ? 'default_edition' : 'default_condition', value });
    };

    const saveKeep = async () => {
        const k = keepPerCard(keepInput);
        setKeepInput(String(k));
        if (window.api) await window.api.saveSetting({ key: 'keep_per_card', value: String(k) });
    };

    const saveDiscount = async () => {
        const n = normalizeDiscount(discountInput);
        setDiscountInput(String(n));
        if (window.api) await window.api.saveSetting({ key: 'sale_discount_percent', value: String(n) });
    };

    const saveMinPrice = async () => {
        const c = normalizeMinPrice(minPriceInput);
        setMinPriceInput((c / 100).toFixed(2).replace('.', ','));
        if (window.api) await window.api.saveSetting({ key: 'sale_min_price', value: (c / 100).toFixed(2) });
    };

    const handleSaveSource = async (e) => {
        const newSource = e.target.value;
        setPriceSource(newSource);
        if (window.api) {
            await window.api.saveSetting({ key: 'price_source', value: newSource });
        }
    };

    const handleUpdatePrices = async () => {
        if (loading) return;
        if (!confirm(`Alle Kartenpreise über ${priceSource} aktualisieren? Das kann eine Weile dauern.`)) return;

        setLoading(true);
        setRunningAction('prices');
        setProgress({ current: 0, total: 0 });
        if (window.api) {
            // This triggers the full update logic in main.cjs, which reads the new setting
            const res = await window.api.updateAllCards();
            if (res.success) {
                alert(`Preise für ${res.updatedCount} Karten erfolgreich aktualisiert.`);
            } else {
                alert("Aktualisierung fehlgeschlagen: " + res.error);
            }
        }
        setLoading(false);
        setRunningAction(null);
    };

    const handleBackup = async () => {
        if (window.api) {
            const res = await window.api.backupDatabase();
            if (res.success) alert("Sicherung erfolgreich gespeichert!");
            else if (res.error) alert("Sicherung fehlgeschlagen: " + res.error);
        }
    };

    const handleRestore = async () => {
        if (confirm("Die Wiederherstellung überschreibt deine aktuelle Datenbank und startet die App neu. Fortfahren?")) {
            if (window.api) {
                const res = await window.api.restoreDatabase();
                if (res.error) alert("Wiederherstellung fehlgeschlagen: " + res.error);
            }
        }
    };

    const handleMoveDb = async () => {
        if(window.api) {
            const res = await window.api.moveDatabase();
            if(res.error) alert("Verschieben fehlgeschlagen: " + res.error);
        }
    };

    const handleReset = async () => {
        if (confirm('Wirklich ALLES löschen? Sammlung, Decks und Einstellungen sind danach weg. Das kann nicht rückgängig gemacht werden.')) {
            if (window.api) {
                const res = await window.api.resetDatabase();
                if (!res.success) alert("Zurücksetzen fehlgeschlagen: " + res.error);
            }
        }
    };

    const handleDowngrade = async () => {
        if (loading) return;
        if (!confirm("Dies durchsucht deine GESAMTE Sammlung und setzt jede Karte auf ihre günstigste Preis-/Common-Variante. Das soll die durch hochwertige Rarity-Standards verursachte Portfolio-Inflation korrigieren. \n\nManuell gesetzte Rarities werden überschrieben, falls eine günstigere Version existiert. Fortfahren?")) return;

        setLoading(true);
        setRunningAction('downgrade');
        setProgress({ current: 0, total: 0 });
        if (window.api) {
            const res = await window.api.downgradeToLowestRarity();
            if (res.success) {
                alert(`Optimierung von ${res.count} Karten auf niedrigste Rarity/Preis abgeschlossen.`);
            } else {
                alert("Optimierung fehlgeschlagen: " + res.error);
            }
        }
        setLoading(false);
        setRunningAction(null);
    };

    // Spec F1 §3: erst der Dateidialog im Hauptprozess, dann die Vorschau (abgebrochen: nichts).
    const handleImport = async () => {
        if (!window.api) return;
        const res = await window.api.importOpen();
        if (res && !res.canceled) setImportOpened(res);
    };

    const handleBuildCatalog = async () => {
        if (runningAction) return;
        setRunningAction('catalog');
        setCatalogResult(null);
        if (window.api) {
            const res = await window.api.buildCatalogNow();
            if (res && res.error) {
                setCatalogResult({ ok: false, text: res.message });
            } else if (res && res.version !== undefined) {
                setCatalogResult({ ok: true, text: `Version ${res.version} hochgeladen (${formatBytes(res.bytes)}).` });
                const status = await window.api.getCatalogStatus();
                if (status) setCatalogStatus(status);
            }
        }
        setRunningAction(null);
    };

    const handleUploadModel = async (kind) => {
        if (uploadingKind) return;
        setUploadingKind(kind);
        setModelResult(null);
        if (window.api) {
            const res = await window.api.uploadModel(kind);
            // A cancelled file dialog comes back as { canceled: true } — a normal outcome, not an error.
            if (res && res.error) {
                setModelResult({ ok: false, text: res.message });
            } else if (res && res.version !== undefined) {
                setModelResult({ ok: true, text: `Version ${res.version} hochgeladen (${formatBytes(res.bytes)}).` });
            }
        }
        setUploadingKind(null);
    };

    // An unknown :bereich (e.g. /einstellungen/quatsch) would otherwise render the Konto card
    // under a bogus URL with nothing highlighted in the sub-nav.
    if (!isKnownSection) return <Navigate to="/einstellungen/konto" replace />;

    return (
        <div className="max-w-5xl mx-auto h-full flex gap-6">
            <nav className="w-52 shrink-0 space-y-1">
                <h1 className="font-display font-semibold text-2xl text-ink mb-4">{T.einstellungen}</h1>
                {SECTIONS.map(s => (
                    <NavLink key={s.id} to={`/einstellungen/${s.id}`}
                        className={({ isActive }) => clsx('block px-3 py-2 rounded-lg text-sm transition-colors',
                            isActive ? 'bg-space-violet/15 text-ink shadow-[inset_0_0_0_1px_rgba(157,0,255,0.35)]'
                                     : (s.id === 'gefahrenzone' ? 'text-crit/70 hover:text-crit' : 'text-ink-muted hover:text-ink'))}>
                        {s.label}
                    </NavLink>
                ))}
            </nav>

            <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar space-y-6 pb-8">
                {active === 'konto' && (
                    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
                        <div className="flex items-center mb-6 text-good border-b border-line pb-4">
                            <Cloud className="w-6 h-6 mr-2" />
                            <h3 className="font-display text-lg text-ink">Cloud-Sync (Supabase)</h3>
                        </div>

                        <div className="space-y-3">
                            <input
                                className="w-full bg-obsidian border border-line text-ink rounded-xl px-4 py-3 focus:outline-none focus:border-space-violet transition-colors"
                                placeholder="Projekt-URL"
                                value={sync.supabase_url}
                                onChange={e => saveSync('supabase_url', e.target.value)}
                            />
                            <input
                                className="w-full bg-obsidian border border-line text-ink rounded-xl px-4 py-3 focus:outline-none focus:border-space-violet transition-colors"
                                placeholder="Anon Key"
                                value={sync.supabase_key}
                                onChange={e => saveSync('supabase_key', e.target.value)}
                            />
                            <input
                                className="w-full bg-obsidian border border-line text-ink rounded-xl px-4 py-3 focus:outline-none focus:border-space-violet transition-colors"
                                placeholder="E-Mail"
                                value={sync.supabase_email}
                                onChange={e => saveSync('supabase_email', e.target.value)}
                            />
                            <input
                                type="password"
                                className="w-full bg-obsidian border border-line text-ink rounded-xl px-4 py-3 focus:outline-none focus:border-space-violet transition-colors"
                                placeholder="Passwort"
                                value={sync.supabase_password}
                                onChange={e => saveSync('supabase_password', e.target.value)}
                            />
                            <label className="flex items-center gap-2 text-ink pt-2">
                                <input
                                    type="checkbox"
                                    checked={sync.sync_enabled === 'true'}
                                    onChange={e => saveSync('sync_enabled', e.target.checked ? 'true' : 'false')}
                                />
                                Sync aktivieren
                            </label>
                            {syncStatus && (
                                <p className={clsx('text-sm', syncStatus.state === 'error' ? 'text-crit' : 'text-ink-muted')}>
                                    {syncStatus.state === 'error' ? 'Fehler' : 'Status'}: {syncStatus.message} {syncStatus.at && `(${new Date(syncStatus.at).toLocaleTimeString()})`}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {active === 'preise' && (
                    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
                        <div className="flex items-center mb-6 text-space-violet border-b border-line pb-4">
                            <DollarSign className="w-6 h-6 mr-2" />
                            <h3 className="font-display text-lg text-ink">Preise</h3>
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-ink-muted mb-2 uppercase tracking-wider">Preisquelle</label>
                                    <select
                                        value={priceSource}
                                        onChange={handleSaveSource}
                                        className="w-full bg-obsidian border border-line text-ink rounded-xl px-4 py-3 focus:outline-none focus:border-space-violet transition-colors cursor-pointer appearance-none"
                                    >
                                        <option value="cardmarket">CardMarket (Europa)</option>
                                        <option value="tcgplayer">TCGPlayer (Nordamerika)</option>
                                        <option value="ebay">eBay</option>
                                        <option value="amazon">Amazon</option>
                                        <option value="coolstuffinc">CoolStuffInc</option>
                                    </select>
                                    <p className="text-xs text-ink-faint mt-2">
                                        Bestimmt, welche Marktdaten für Portfolio-Bewertung und Kartendetails verwendet werden.
                                    </p>
                                </div>

                                <div className="flex items-end">
                                    <button
                                        onClick={handleUpdatePrices}
                                        disabled={runningAction === 'prices'}
                                        className="w-full flex items-center justify-center px-6 py-3 bg-space-violet hover:bg-space-violet-dark text-white rounded-xl font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-space-violet/20"
                                    >
                                        <RefreshCw className={`w-5 h-5 mr-2 ${runningAction === 'prices' ? 'animate-spin' : ''}`} />
                                        {runningAction === 'prices' ? 'Preise werden aktualisiert…' : 'Preise jetzt aktualisieren'}
                                    </button>
                                </div>
                            </div>

                            {runningAction === 'prices' && progress.total > 0 && (
                                <div>
                                    <div className="flex justify-between text-xs text-ink-muted mb-1">
                                        <span>Verarbeitung läuft…</span>
                                        <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                                    </div>
                                    <div className="bg-obsidian rounded-full h-2 overflow-hidden border border-line">
                                        <div
                                            className="bg-space-violet h-full transition-all duration-300"
                                            style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            <PriceAlertSettings />
                        </div>
                    </div>
                )}

                {active === 'ebay' && <EbaySettings />}

                {active === 'verbindung' && (
                    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
                        <h3 className="font-display text-lg text-ink mb-1">Verbindung zum Handy</h3>
                        <p className="text-sm text-ink-muted mb-4">Die Handy-App verbindet sich mit dieser Adresse (Port 4000). Beide Geräte müssen im selben WLAN sein.</p>
                        <code className="block bg-obsidian border border-line rounded-lg px-4 py-3 text-center font-mono text-lg text-ink select-all cursor-pointer hover:bg-black/40 transition-colors"
                              title="Zum Kopieren klicken" onClick={() => navigator.clipboard.writeText(ipAddress)}>{ipAddress}</code>
                    </div>
                )}

                {active === 'daten' && (
                    <>
                    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
                        <div className="flex items-center mb-6 text-space-violet border-b border-line pb-4">
                            <Database className="w-6 h-6 mr-2" />
                            <h3 className="font-display text-lg text-ink">Daten</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                onClick={handleBackup}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <Download className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Datenbank sichern</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Speichert deine gesamte Sammlung und alle Decks in einer lokalen Datei.</p>
                            </button>

                            <button
                                onClick={handleMoveDb}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <FolderInput className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Speicherort verschieben</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Verschiebt die Daten in einen OneDrive/Dropbox-Ordner für Cloud-Sync (Neustart erforderlich).</p>
                            </button>

                            <button
                                onClick={handleRestore}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <FileUp className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Sicherung wiederherstellen</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Stellt eine vorherige Sicherungsdatei wieder her (Neustart erforderlich).</p>
                            </button>

                            <button
                                onClick={async () => {
                                    if (confirm("Alle Karten mit Set 'Unknown' werden gesucht und, falls möglich, mit der passenden Version zusammengeführt. Fortfahren?")) {
                                        if(window.api) {
                                            const res = await window.api.cleanupDatabase();
                                            if(res.success) alert(`${res.merged} Einträge zusammengeführt.`);
                                            else alert("Fehler: " + res.error);
                                        }
                                    }
                                }}
                                className="p-4 bg-space-violet/10 hover:bg-space-violet/20 rounded-xl border border-space-violet/30 hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-space-violet mb-2">
                                    <RefreshCw className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Duplikate zusammenführen</h4>
                                </div>
                                <p className="text-sm text-space-violet/60 group-hover:text-space-violet">Führt alte 'Unknown'-Karten mit den passenden Sets zusammen, um doppelte Wertanzeige zu vermeiden.</p>
                            </button>

                            <button
                                onClick={handleImport}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <FileUp className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Importieren…</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Liest eine Card-Dex-CSV mit Vorschau ein – Exemplare, Behälter, Seite/Fach, Tags und Notizen.</p>
                            </button>

                            <button
                                onClick={() => setExportOpen(true)}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <Download className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Exportieren…</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Card Dex, Dragon Shield, YGOPRODeck, Cardmarket-Wantslist oder Verkaufsliste.</p>
                            </button>
                        </div>
                        {importOpened && <ImportDialog opened={importOpened} onClose={() => setImportOpened(null)} />}
                        {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
                    </div>

                    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
                        <div className="flex items-center mb-6 text-space-violet border-b border-line pb-4">
                            <Cloud className="w-6 h-6 mr-2" />
                            <h3 className="font-display text-lg text-ink">Katalog</h3>
                        </div>
                        <p className="text-sm text-ink-muted mb-4">Name, Text und Printings aller Karten — das Handy scannt damit ohne Netz.</p>
                        <p className="text-sm text-ink-muted mb-4">
                            {catalogStatus.lastRun
                                ? `Version ${catalogStatus.version} · ${formatBytes(catalogStatus.bytes)} · gebaut am ${new Date(catalogStatus.lastRun).toLocaleDateString('de-DE')}`
                                : 'Noch nie gebaut.'}
                        </p>
                        <button
                            onClick={handleBuildCatalog}
                            disabled={runningAction === 'catalog'}
                            className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div className="flex items-center text-ink mb-2">
                                <RefreshCw className={`w-5 h-5 mr-2 ${runningAction === 'catalog' ? 'animate-spin' : ''}`} />
                                <h4 className="font-bold">{runningAction === 'catalog' ? 'Wird gebaut…' : 'Katalog jetzt bauen'}</h4>
                            </div>
                        </button>
                        {catalogResult && (
                            <p className={`text-sm mt-4 ${catalogResult.ok ? 'text-good' : 'text-crit'}`}>{catalogResult.text}</p>
                        )}
                    </div>

                    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
                        <div className="flex items-center mb-6 text-space-violet border-b border-line pb-4">
                            <Cpu className="w-6 h-6 mr-2" />
                            <h3 className="font-display text-lg text-ink">Scanner-Modell</h3>
                        </div>
                        <p className="text-sm text-ink-muted mb-4">Neue Modelldateien landen ohne neue App-Version auf dem Handy.</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <button
                                onClick={() => handleUploadModel('index')}
                                disabled={!!uploadingKind}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <UploadCloud className={`w-5 h-5 mr-2 ${uploadingKind === 'index' ? 'animate-bounce' : ''}`} />
                                    <h4 className="font-bold">{uploadingKind === 'index' ? 'Wird hochgeladen…' : 'Index hochladen'}</h4>
                                </div>
                            </button>
                            <button
                                onClick={() => handleUploadModel('embedder')}
                                disabled={!!uploadingKind}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <UploadCloud className={`w-5 h-5 mr-2 ${uploadingKind === 'embedder' ? 'animate-bounce' : ''}`} />
                                    <h4 className="font-bold">{uploadingKind === 'embedder' ? 'Wird hochgeladen…' : 'Embedder hochladen'}</h4>
                                </div>
                            </button>
                            <button
                                onClick={() => handleUploadModel('detector')}
                                disabled={!!uploadingKind}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <UploadCloud className={`w-5 h-5 mr-2 ${uploadingKind === 'detector' ? 'animate-bounce' : ''}`} />
                                    <h4 className="font-bold">{uploadingKind === 'detector' ? 'Wird hochgeladen…' : 'Detektor hochladen'}</h4>
                                </div>
                            </button>
                        </div>
                        {modelResult && (
                            <p className={`text-sm mt-4 ${modelResult.ok ? 'text-good' : 'text-crit'}`}>{modelResult.text}</p>
                        )}
                    </div>
                    </>
                )}

                {active === 'standards' && (
                    <div className="bg-[#1E1E1E] p-6 rounded-2xl border border-gray-800 shadow-xl">
                        <div className="flex items-center mb-6 text-gold border-b border-gray-800 pb-4">
                            <Layers className="w-6 h-6 mr-2" />
                            <h3 className="text-xl font-bold text-white">Standards für neue Exemplare</h3>
                        </div>
                        <p className="text-xs text-gray-500 mb-4">Jeder Scan legt Exemplare mit diesen Werten an. Abweichungen setzt du pro Zeile im Staging oder im Karten-Detail.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Zustand</label>
                                <div className="flex gap-1 flex-wrap">
                                    {CONDITIONS.map(c => (
                                        <button key={c} onClick={() => saveDefault('condition', c)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-mono ${defaults.condition === c ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 border border-gray-700 hover:bg-gray-800'}`}>{c}</button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Edition</label>
                                <div className="flex gap-1 flex-wrap">
                                    {EDITIONS.map(e => (
                                        <button key={e} onClick={() => saveDefault('edition', e)}
                                            className={`px-3 py-1.5 rounded-lg text-sm ${defaults.edition === e ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 border border-gray-700 hover:bg-gray-800'}`}>{EDITION_LABELS[e]}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-800">
                            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Duplikate: behalten je Karte</label>
                            <input type="number" min="1" max="99" step="1" value={keepInput}
                                onChange={e => setKeepInput(e.target.value)} onBlur={saveKeep}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="w-24 bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-space-violet" />
                            <p className="text-xs text-gray-500 mt-2">Alles über dieser Anzahl je Karte (über alle Printings) erscheint unter „Duplikate“. Ganze Zahl 1–99, Standard 3. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.</p>
                        </div>
                        <SaleChannelSettings />
                        <div className="mt-6 pt-6 border-t border-gray-800">
                            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Preisvorschlag: Abschlag in %</label>
                            <input type="number" min="0" max="90" step="1" value={discountInput}
                                onChange={e => setDiscountInput(e.target.value)} onBlur={saveDiscount}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="w-24 bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-space-violet" />
                            <label className="block text-sm font-bold text-gray-400 mb-2 mt-4 uppercase tracking-wider">Mindestpreis in €</label>
                            <input inputMode="decimal" value={minPriceInput}
                                onChange={e => setMinPriceInput(e.target.value)} onBlur={saveMinPrice}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="w-24 bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-space-violet" />
                            <p className="text-xs text-gray-500 mt-2">Vorschlag = Marktwert minus Abschlag, auf 5 Cent abgerundet, nie unter dem Mindestpreis. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.</p>
                        </div>
                    </div>
                )}

                {active === 'gefahrenzone' && (
                    <div className="bg-obsidian-700 border border-crit/30 rounded-2xl p-6">
                        <div className="flex items-center mb-6 text-crit border-b border-crit/20 pb-4">
                            <Trash2 className="w-6 h-6 mr-2" />
                            <h3 className="font-display text-lg text-crit">Gefahrenzone</h3>
                        </div>

                        {runningAction === 'downgrade' && progress.total > 0 && (
                            <div className="mb-6">
                                <div className="flex justify-between text-xs text-ink-muted mb-1">
                                    <span>Verarbeitung läuft…</span>
                                    <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                                </div>
                                <div className="bg-obsidian rounded-full h-2 overflow-hidden border border-line">
                                    <div
                                        className="bg-crit h-full transition-all duration-300"
                                        style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <button
                                onClick={handleDowngrade}
                                disabled={runningAction === 'downgrade'}
                                className="p-4 bg-crit/10 hover:bg-crit/20 rounded-xl border border-crit/30 hover:border-crit/50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className="flex items-center text-crit mb-2">
                                    <TrendingDown className={`w-5 h-5 mr-2 ${runningAction === 'downgrade' ? 'animate-bounce' : ''}`} />
                                    <h4 className="font-bold">Auf günstigste Rarity umstellen</h4>
                                </div>
                                <p className="text-sm text-crit/60 group-hover:text-crit">
                                    Setzt jede Karte auf ihre günstigste Druckvariante. Manuell gesetzte Rarities werden überschrieben.
                                </p>
                            </button>

                            <button
                                onClick={handleReset}
                                className="p-4 bg-crit/10 hover:bg-crit/20 rounded-xl border border-crit/30 hover:border-crit/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-crit mb-2">
                                    <Trash2 className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Alles zurücksetzen</h4>
                                </div>
                                <p className="text-sm text-crit/60 group-hover:text-crit">Löscht alle Daten unwiderruflich. Kann nicht rückgängig gemacht werden.</p>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Spec H2 §8 -- Verkaufskanäle: Gebühr je Kanal, eigene Kanäle anlegen/umbenennen/ausblenden. Feste Kanäle behalten ihren Namen.
const feeText = (v) => String(v ?? 0).replace('.', ',');
const feeValue = (s) => (String(s ?? '').trim() === '' ? 0 : Number(String(s).trim().replace(',', '.')));

function SaleChannelSettings() {
    const [gate] = useState(createBusyGate);
    const [channels, setChannels] = useState(null);
    const [drafts, setDrafts] = useState({}); // channel_id -> { name, fee }
    const [fresh, setFresh] = useState({ name: '', fee: '' });
    const [error, setError] = useState(null);

    const load = useCallback(() => (window.api?.listSaleChannels ? window.api.listSaleChannels() : Promise.resolve([]))
        .then((ch) => {
            const list = Array.isArray(ch) ? ch : [];
            setChannels(list);
            setDrafts(Object.fromEntries(list.map((c) => [c.channel_id, { name: c.name, fee: feeText(c.fee_percent) }])));
        })
        .catch(() => setError('Kanäle konnten nicht geladen werden.')), []);
    useEffect(() => { load(); }, [load]);

    const write = (call) => gate.run(async () => {
        setError(null);
        try {
            const res = await call();
            if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
            await load();
        } catch (e) { setError(e?.message || 'Speichern fehlgeschlagen.'); }
    });
    const setDraft = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
    const save = (c) => write(() => window.api.saveSaleChannel({ channel_id: c.channel_id, name: c.builtin ? c.name : drafts[c.channel_id]?.name, fee_percent: feeValue(drafts[c.channel_id]?.fee) }));
    const hide = (c) => write(() => window.api.hideSaleChannel(c.channel_id));
    const create = () => write(async () => {
        const res = await window.api.saveSaleChannel({ name: fresh.name, fee_percent: feeValue(fresh.fee) });
        if (res?.success) setFresh({ name: '', fee: '' });
        return res;
    });

    const input = 'bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet';
    const btn = 'px-3 py-2 rounded-lg text-sm bg-black/40 text-gray-300 border border-gray-700 hover:bg-gray-800';
    return (
        <div className="mt-6 pt-6 border-t border-gray-800">
            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Verkaufskanäle</label>
            {!channels ? <p className="text-sm text-gray-500">…</p> : (
                <div className="space-y-2">
                    {channels.map((c) => (
                        <div key={c.channel_id} className="flex flex-wrap items-center gap-2">
                            {c.builtin
                                ? <span className="w-48 text-sm text-white">{c.name}</span>
                                : <input className={`w-48 ${input}`} value={drafts[c.channel_id]?.name ?? ''} onChange={(e) => setDraft(c.channel_id, { name: e.target.value })} />}
                            <input inputMode="decimal" className={`w-20 font-mono ${input}`} value={drafts[c.channel_id]?.fee ?? ''} onChange={(e) => setDraft(c.channel_id, { fee: e.target.value })} />
                            <span className="text-sm text-gray-500">%</span>
                            <button type="button" onClick={() => save(c)} className={btn}>Speichern</button>
                            {!c.builtin && <button type="button" onClick={() => hide(c)} className={btn}>Ausblenden</button>}
                        </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                        <input className={`w-48 ${input}`} placeholder="Neuer Kanal" value={fresh.name} onChange={(e) => setFresh((f) => ({ ...f, name: e.target.value }))} />
                        <input inputMode="decimal" className={`w-20 font-mono ${input}`} placeholder="0" value={fresh.fee} onChange={(e) => setFresh((f) => ({ ...f, fee: e.target.value }))} />
                        <span className="text-sm text-gray-500">%</span>
                        <button type="button" onClick={create} className={btn}>Anlegen</button>
                    </div>
                </div>
            )}
            {error && <p className="text-sm text-crit mt-2">{error}</p>}
            <p className="text-xs text-gray-500 mt-2">Gebühren sind vorbelegt – bitte mit deinen eigenen Konditionen abgleichen. Alte Verkäufe behalten den Namen, den der Kanal beim Buchen hatte.</p>
        </div>
    );
}
