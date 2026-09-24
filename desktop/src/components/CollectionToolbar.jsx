import clsx from 'clsx';
import { Search, SlidersHorizontal, Coins, AlertCircle, Download } from 'lucide-react';
import CustomSelect from './CustomSelect';
import ExportDialog from './ExportDialog';

// Spec I §10 -- aus CollectionList.jsx verschoben (reine Verschiebung): Werkzeugleiste der Kartenliste (Anzahl,
// Suche, Sortierung, Filter-Knopf, Export, Preise-Menue) und die Ladefehler-Banner. Zustand und Logik bleiben in
// CollectionList.jsx und kommen gebuendelt in `t` herein.
export default function CollectionToolbar({ t }) {
  const { filter, setFilter, sortType, setSortType, setFiltersOpen, filtersOpen, activeFilters, openExport, exportCopyIds, setExportCopyIds, setPricesOpen, pricesOpen, runBulk, cmBulkBusy, cmRunning, cmProgress, runCardmarket, cmAuto, toggleCmAuto, cmMinRank, setCmMinRank, handleUpdate, updating, cmStatus, relTime, containersTagsError, copiesLoadError, count } = t;
  return (
    <>
      {/* Row 1: count, search, sort, filter toggle, prices menu */}
      <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted text-sm shrink-0">{count} Karten</span>
          <div className="relative group flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input type="text" placeholder="Suchen…" className="bg-bg border border-line text-text pl-10 pr-4 py-2 rounded-lg w-full focus:border-accent outline-none"
                     value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <CustomSelect value={sortType} onChange={setSortType} placeholder="Sortierung" className="w-[170px]" options={[
              { value: 'newest', label: 'Neueste' }, { value: 'total', label: 'Wert (gesamt)' }, { value: 'price', label: 'Preis (einzeln)' },
              { value: 'name', label: 'Name' }, { value: 'atk', label: 'ATK' }, { value: 'def', label: 'DEF' }, { value: 'level', label: 'Level' }]} />
          <button onClick={() => setFiltersOpen(o => !o)}
                  className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
                    filtersOpen || activeFilters.length ? 'bg-accent/15 border-accent/40 text-text' : 'bg-surface border-line text-muted hover:text-text')}>
              <SlidersHorizontal className="w-4 h-4" /> Filter
              {activeFilters.length > 0 && <span className="font-mono text-klein bg-accent text-accent-fg rounded-full px-1.5">{activeFilters.length}</span>}
          </button>
          <button onClick={openExport} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-surface border border-line text-muted hover:text-text">
              <Download className="w-4 h-4" /> Exportieren…
          </button>
          {exportCopyIds && <ExportDialog filterCopyIds={exportCopyIds} onClose={() => setExportCopyIds(null)} />}
          <div className="relative">
              <button onClick={() => setPricesOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-surface border border-line text-muted hover:text-text">
                  <Coins className="w-4 h-4" /> Preise
              </button>
              {pricesOpen && (
                <div className="absolute right-0 top-11 z-30 w-[320px] bg-bg border border-line rounded-xl shadow-sm p-3 space-y-2"
                     onMouseLeave={() => setPricesOpen(false)}>
                  <button onClick={runBulk} disabled={cmBulkBusy || cmRunning}
                          className="w-full text-left px-3 py-2 rounded-lg bg-accent hover:underline text-accent-fg text-sm disabled:opacity-50">
                    {cmBulkBusy ? 'Aktualisiere…' : 'Jetzt aktualisieren (Preisdatei)'}
                  </button>
                  <button onClick={cmRunning ? () => window.api.abortCardmarketScrape() : runCardmarket}
                          className="w-full text-left px-3 py-2 rounded-lg bg-surface border border-line text-text text-sm hover:border-accent/40">
                    {cmRunning ? `Abbrechen${cmProgress ? ` (${cmProgress.current}/${cmProgress.total})` : ''}` : 'Rest scrapen'}
                  </button>
                  <label className="flex items-center gap-2 px-3 py-2 text-sm text-muted cursor-pointer select-none">
                    <input type="checkbox" checked={cmAuto} onChange={toggleCmAuto} className="accent-accent" />
                    Automatisch im Hintergrund
                  </label>
                  <div className="px-3">
                    <div className="text-klein uppercase tracking-wider text-muted mb-1">Ab Rarity</div>
                    <select value={cmMinRank} onChange={(e) => { const v = Number(e.target.value); setCmMinRank(v); if (cmAuto) window.api?.saveSetting?.({ key: 'cm_auto_min_rank', value: String(v) }); }}
                            className="w-full px-2 py-1.5 rounded bg-bg border border-line text-text text-sm">
                      <option value={1}>Alle Rarities</option>
                      <option value={2}>Ab Rare</option>
                      <option value={3}>Ab Super Rare</option>
                      <option value={4}>Ab Ultra Rare</option>
                      <option value={5}>Ab Secret Rare</option>
                      <option value={6}>Ab Ultimate Rare</option>
                      <option value={7}>Ab Ghost / Collector's</option>
                      <option value={8}>Nur Quarter Century</option>
                    </select>
                  </div>
                  <div className="border-t border-line pt-2 px-3 space-y-1">
                    <button onClick={() => handleUpdate('missing')} disabled={updating} className="text-sm text-muted hover:text-text">Fehlende Daten holen</button>
                    <button onClick={() => handleUpdate('all')} disabled={updating} className="block text-sm text-muted hover:text-text">Alle Karten aktualisieren</button>
                    {cmStatus && (
                      <div className="text-klein text-muted pt-1">
                        Letztes Update {relTime(cmStatus.lastRun)} · {cmStatus.resolvedCount} per Datei · {cmStatus.unresolvedCount} offen
                      </div>
                    )}
                  </div>
                </div>
              )}
          </div>
      </div>

      {/* Fix-Durchlauf 1, Befund 1: diese Banner muessen sichtbar sein, egal ob das
          Filter-Panel offen ist -- sonst sieht der Nutzer bei geschlossenem Panel nicht,
          dass Behaelter-/Tag-Filter und die Notiz-/Tag-Textsuche gerade still leere
          Ergebnisse liefern (dieselbe Fehlerklasse wie in Task 5). Gleicher Anzeigebau wie
          Binders.jsx (roter bad-Kasten mit Symbol). */}
      {containersTagsError && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{containersTagsError}</span>
          </div>
      )}
      {copiesLoadError && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-bad/40 bg-bad/10 text-sm text-text">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{copiesLoadError}</span>
          </div>
      )}

    </>
  );
}
