import clsx from 'clsx';
import { FilterX, X } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { PRESETS } from '../utils/cardFilters.js';

// Spec I §10 -- aus CollectionList.jsx verschoben (reine Verschiebung): Filterbereich der Kartenliste --
// Voreinstellungen, Auswahllisten, Behaelter/Tags und die entfernbaren Chips aktiver Filter. Zustand und Logik
// bleiben in CollectionList.jsx und kommen gebuendelt in `f` herein.
export default function CollectionFilters({ f }) {
  const { filtersOpen, presets, togglePreset, filterType, setFilterType, filterLang, setFilterLang, filterAttribute, setFilterAttribute, attributes, filterRace, setFilterRace, races, filterRarity, setFilterRarity, rarities, filterCondition, setFilterCondition, filterEdition, setFilterEdition, filterSet, setFilterSet, sets, clearFilters, containers, filterContainers, toggleContainerFilter, tagOptions, filterTags, toggleTagFilter, activeFilters } = f;
  return (
    <>
      {/* Row 2: gespeicherte Filter (Spec I §3.3) -- Abschlussreview B3: erste Zeile im Filter-Bereich,
          keine dauerhaft sichtbare Chip-Zeile. Aktive Voreinstellungen stehen als entfernbare Chips unten. */}
      {filtersOpen && (
      <div className="flex flex-wrap items-center gap-2">
          <span className="text-klein uppercase tracking-wide text-muted mr-1 shrink-0">Voreinstellungen</span>
          {PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => togglePreset(p.id)}
                  className={clsx('px-3 py-1.5 rounded-full text-xs border',
                      presets.includes(p.id) ? 'bg-accent text-accent-fg border-transparent' : 'bg-surface-2 text-muted border-line')}>
                  {p.label}
              </button>
          ))}
      </div>
      )}

      {/* Row 3: filter dropdowns, only when open */}
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-3">
            <CustomSelect value={filterType} onChange={setFilterType} placeholder="Typ" className="w-[120px]" options={[{ value: "All", label: "Typ" }, { value: "Monster", label: "Monster" }, { value: "Spell", label: "Spell" }, { value: "Trap", label: "Trap" }, { value: "Link", label: "Link" }, { value: "XYZ", label: "XYZ" }, { value: "Synchro", label: "Synchro" }, { value: "Fusion", label: "Fusion" }]} />
            <CustomSelect value={filterLang} onChange={setFilterLang} placeholder="Sprache" className="w-[90px]" options={[{ value: "All", label: "Sprache" }, { value: "DE", label: "DE" }, { value: "EN", label: "EN" }, { value: "JP", label: "JP" }]} />
            <CustomSelect value={filterAttribute} onChange={setFilterAttribute} placeholder="Attribut" className="w-[120px]" options={[{ value: "All", label: "Attribut" }, ...attributes]} />
            <CustomSelect value={filterRace} onChange={setFilterRace} placeholder="Rasse/Typ" className="w-[130px]" options={[{ value: "All", label: "Rasse/Typ" }, ...races]} />
            <CustomSelect value={filterRarity} onChange={setFilterRarity} placeholder="Seltenheit" className="w-[130px]" options={[{ value: "All", label: "Seltenheit" }, ...rarities]} />
            <CustomSelect value={filterCondition} onChange={setFilterCondition} placeholder="Zustand" className="w-[110px]" options={[{ value: 'All', label: 'Zustand' }, ...CONDITIONS.map(c => ({ value: c, label: c }))]} />
            <CustomSelect value={filterEdition} onChange={setFilterEdition} placeholder="Edition" className="w-[120px]" options={[{ value: 'All', label: 'Edition' }, ...EDITIONS.map(e => ({ value: e, label: EDITION_LABELS[e] }))]} />
            <CustomSelect value={filterSet} onChange={setFilterSet} placeholder="Set" className="w-[120px]" options={[{ value: "All", label: "Set" }, ...sets]} />
            <button onClick={clearFilters} title="Filter zurücksetzen" className="p-2 text-muted hover:text-bad"><FilterX className="w-4 h-4" /></button>
        </div>
      )}

      {/* Row 3b: Behaelter- und Tag-Filter (Spec B1 §7.4) -- beide mehrfach waehlbar, deshalb
          Toggle-Chips statt CustomSelect (das ist Einfachauswahl). */}
      {filtersOpen && containers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-klein uppercase tracking-wide text-muted mr-1 shrink-0">Behälter</span>
            {containers.map(ct => (
                <button key={ct.container_id} type="button" onClick={() => toggleContainerFilter(ct.container_id)}
                        className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors',
                          filterContainers.includes(ct.container_id) ? 'bg-accent/20 border-accent/50 text-text' : 'bg-surface border-line text-muted hover:text-text')}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ct.color || '#6b6383' }} />
                    {ct.name}
                </button>
            ))}
        </div>
      )}
      {filtersOpen && tagOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-klein uppercase tracking-wide text-muted mr-1 shrink-0">Tags</span>
            {tagOptions.map(t => (
                <button key={t} type="button" onClick={() => toggleTagFilter(t)}
                        className={clsx('px-2.5 py-1 rounded-full text-xs border transition-colors',
                          filterTags.includes(t) ? 'bg-accent/20 border-accent/50 text-text' : 'bg-surface border-line text-muted hover:text-text')}>
                    {t}
                </button>
            ))}
        </div>
      )}

      {/* Row 4: active-filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map(f => (
            <button key={f.key} onClick={f.clear}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/15 border border-accent/30 text-text text-xs">
              {f.label} <X className="w-3 h-3 opacity-60" />
            </button>
          ))}
          <button onClick={clearFilters} className="text-xs text-muted hover:text-bad">Alle entfernen</button>
        </div>
      )}
    </>
  );
}
