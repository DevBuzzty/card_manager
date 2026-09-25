import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import CollectionToolbar from './CollectionToolbar';
import CollectionFilters from './CollectionFilters';
import CollectionGrid from './CollectionGrid';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { cardRoute } from '../utils/routes';
import { parseTags } from '../utils/tags';
// Spec B1 §7.4: card_copies kommt ueber listCopies() je Printing herein -- derselbe vierteilige
// Schluessel wie ueberall sonst im Projekt (id/set_code/language/rarity). Er wohnt in
// ../utils/printingKey.js, damit es ihn nur EINMAL gibt (BinderView.jsx liest denselben).
import { printingKey } from '../utils/printingKey';
import { passcodeMatches } from '../utils/passcode';
import { PRESETS, matchesPresetGroup, presetsFromState } from '../utils/cardFilters.js';
import { filterCopyIds } from '../utils/exportScope';
import { useSaleData } from '../hooks/useSaleData';
import { rarityDisplay } from '../utils/printingRarity';
import { selectionCopies, sellSubtitle } from '../utils/selection';
import { SelectionBar, MoveDialog } from './CollectionSelection';
import SellFlowDialog from './SellFlowDialog';
import { useToast } from './toastContext';

export default function CollectionList({ isUpdating, setUpdateProgress }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [rawCards, setRawCards] = useState([]);
  const [filter, setFilter] = useState('');
  const [localUpdating, setLocalUpdating] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [sortType, setSortType] = useState('newest');

  // Filters
  const [filterType, setFilterType] = useState('All');
  const [filterAttribute, setFilterAttribute] = useState('All');
  const [filterRace, setFilterRace] = useState('All');
  const [filterSet, setFilterSet] = useState('All');
  const [filterLang, setFilterLang] = useState('All');
  const [filterRarity, setFilterRarity] = useState('All');
  const [filterCondition, setFilterCondition] = useState('All');
  const [filterEdition, setFilterEdition] = useState('All');
  // Spec B1 §7.4: Behaelter/Tag-Filter, mehrfach waehlbar; leer heisst "nicht filtern".
  const [filterContainers, setFilterContainers] = useState([]);
  const [filterTags, setFilterTags] = useState([]);
  const [containers, setContainers] = useState([]); // fuer Filter-Chips und den Standort-Chip in der Zeile
  const [tagOptions, setTagOptions] = useState([]); // Tag-Vokabular aus listTags() fuer die Filter-Chips
  const [copiesByPrinting, setCopiesByPrinting] = useState({}); // printingKey() -> card_copies-Zeilen dieses Printings
  const [containersTagsError, setContainersTagsError] = useState(null);
  const [copiesLoadError, setCopiesLoadError] = useState(null);
  const sale = useSaleData(); // fuer den "davon zum Verkauf"-Zusatz an jeder Kachel (forSaleByCard unten)
  // Spec I §3.3: "Unvollstaendig" und "Foils" sind jetzt gespeicherte Filter statt Chips, siehe cardFilters.js.
  // Abschlussreview B5: eine Start-Kachel kann eine Voreinstellung mitgeben (location.state.preset).
  const [presets, setPresets] = useState(() => presetsFromState(location.state));
  const togglePreset = (id) => setPresets(ps => ps.includes(id) ? ps.filter(x => x !== id) : [...ps, id]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [cmRunning, setCmRunning] = useState(false);
  const [cmProgress, setCmProgress] = useState(null);
  const [cmMinRank, setCmMinRank] = useState(5); // default: from Secret Rare up (skip cheap commons)
  const [cmAuto, setCmAuto] = useState(false); // background auto-refresh toggle
  const [cmBulkBusy, setCmBulkBusy] = useState(false);
  const [cmStatus, setCmStatus] = useState(null); // { lastRun, resolvedCount, unresolvedCount }
  const [exportCopyIds, setExportCopyIds] = useState(null); // Spec F1 §4: offen = Exemplar-IDs des aktuellen Filters

  const relTime = (iso) => {
    if (!iso) return 'noch nie';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'gerade eben';
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60);
    if (h < 48) return `vor ${h} Std.`;
    return `vor ${Math.round(h / 24)} Tagen`;
  };

  const updating = isUpdating || localUpdating;

  useEffect(() => {
    const off = window.api?.onUpdateProgress?.((p) => setCmProgress(p));
    const offCh = window.api?.onCmChallenge?.(() => {
      if (confirm('Cardmarket verlangt eine kurze Cloudflare-Prüfung. Prüf-Fenster jetzt öffnen und lösen? (Danach läuft es automatisch weiter.)')) {
        window.api?.revealCmWindow?.();
      }
    });
    (async () => {
      const s = await window.api?.getSettings?.();
      if (s) {
        setCmAuto(s.cm_auto_enabled === 'true');
        if (s.cm_auto_min_rank) setCmMinRank(Number(s.cm_auto_min_rank));
      }
    })();
    return () => { off && off(); offCh && offCh(); };
  }, []);

  const toggleCmAuto = async () => {
    const next = !cmAuto;
    setCmAuto(next);
    await window.api?.saveSetting?.({ key: 'cm_auto_enabled', value: next ? 'true' : 'false' });
    await window.api?.saveSetting?.({ key: 'cm_auto_min_rank', value: String(cmMinRank) });
  };

  const runCardmarket = async () => {
    setCmRunning(true);
    try {
      const r = await window.api.scrapeCardmarketPrices(cmMinRank);
      if (r?.busy) { alert('Cardmarket läuft gerade schon (Scraper oder Update). Bitte kurz warten.'); return; }
      let msg = `Cardmarket fertig: ${r.updated} aktualisiert, ${r.noMatch} ohne Treffer, ${r.errors} Fehler.`;
      if (r.noMatchList && r.noMatchList.length) {
        msg += `\n\nOhne Treffer (bitte manuell setzen):\n` + r.noMatchList.slice(0, 40).join('\n')
             + (r.noMatchList.length > 40 ? `\n… +${r.noMatchList.length - 40} weitere` : '');
      }
      alert(msg);
    }
    finally { setCmRunning(false); setCmProgress(null); }
  };

  const runBulk = async () => {
    setCmBulkBusy(true);
    try {
      const r = await window.api.cardmarketBulkRefresh();
      if (r?.busy) { alert('Cardmarket läuft gerade schon (Scraper oder Update). Bitte kurz warten.'); return; }
      if (r?.error) { alert(`Cardmarket-Update fehlgeschlagen: ${r.message || r.error}`); return; }
      alert(`Cardmarket-Update fertig: ${r.priced} Preise aus der Datei gesetzt, ${r.resolved} neu zugeordnet, ${r.unresolved} offen (per Scraper).`);
      loadCollection();
    } finally { setCmBulkBusy(false); }
  };

  // Behaelter- und Tag-Vokabular fuer die Filter-Chips (Spec B1 §7.4) -- list-containers/list-tags
  // WERFEN bei einem DB-Fehler statt {success:false} zu liefern (main.cjs), gleiche Bauart wie
  // Binders.jsx/CopySheet.jsx: ein Ladefehler bleibt sichtbar statt wie eine leere Liste auszusehen.
  // Fix-Durchlauf 1, Befund 4: wird bei jedem loadCollection() neu geladen (statt nur beim
  // Einhaengen), sonst zeigt ein Filter-Chip nach einem Behaelter-Loeschen/-Anlegen in einer
  // anderen Ansicht weiter das veraltete Vokabular.
  const loadVocabulary = async () => {
    try {
      const [c, t] = await Promise.all([
        window.api?.listContainers?.() ?? [],
        window.api?.listTags?.() ?? [],
      ]);
      setContainers(Array.isArray(c) ? c : []);
      setTagOptions(Array.isArray(t) ? t : []);
      setContainersTagsError(null);
    } catch (e) {
      setContainersTagsError(e?.message || 'Behälter und Tags konnten nicht geladen werden.');
    }
  };

  const loadCollection = async () => {
    if (window.api) {
      const result = await window.api.getCollection();
      setRawCards(result);
      const s = await window.api?.cardmarketBulkStatus?.();
      if (s) setCmStatus(s);
    }
    loadVocabulary();
  };

  useEffect(() => { loadCollection(); }, [updating]);

  // Reload when the sync cycle pulls changes from the phone
  useEffect(() => {
    if (!window.api || !window.api.onCollectionChanged) return;
    const cleanup = window.api.onCollectionChanged(() => loadCollection());
    return () => cleanup && cleanup();
  }, []);

  // The detail panel dispatches this after a mutation (it can't carry an onClose callback
  // through a route), so reload here instead.
  useEffect(() => {
    const onDirty = () => loadCollection();
    window.addEventListener('collection-dirty', onDirty);
    return () => window.removeEventListener('collection-dirty', onDirty);
  }, []);

  // Behaelter/Tag/Notiz-Filter und die Textsuche darauf greifen am EXEMPLAR (card_copies), diese
  // Liste gruppiert aber nach Printing (rawCards: ein Eintrag je Set/Sprache/Rarity) -- deshalb
  // hier ALLE lebenden Exemplare der Sammlung in EINEM Kanal laden (Fix-Durchlauf 1, Befund 2:
  // vorher listCopies(printing) je Printing einzeln in einem Promise.all, bei mehreren tausend
  // Printings entsprechend viele einzelne IPC-Rundreisen auf dem Single-Thread-Hauptprozess) und
  // hier im Renderer nach Printing gruppieren.
  useEffect(() => {
    let alive = true;
    if (!window.api?.listAllCopies) { setCopiesByPrinting({}); return; }
    (async () => {
      try {
        const rows = await window.api.listAllCopies();
        if (!alive) return;
        const grouped = {};
        for (const cp of rows) {
          const key = printingKey({ id: cp.card_id, set_code: cp.set_code, language: cp.language, rarity: cp.rarity });
          (grouped[key] || (grouped[key] = [])).push(cp);
        }
        setCopiesByPrinting(grouped);
        setCopiesLoadError(null);
      } catch (e) {
        if (!alive) return;
        setCopiesLoadError(e?.message || 'Exemplardaten konnten nicht geladen werden.');
      }
    })();
    return () => { alive = false; };
  }, [rawCards]);

  const handleUpdate = async (mode) => {
    if (!window.api || updating) return;
    if (!confirm(mode === 'all' ? "Alle Karten aktualisieren?" : "Fehlende Daten nachladen?")) return;
    setLocalUpdating(true);
    setUpdateProgress({ current: 0, total: 0 });
    try {
        const result = mode === 'all' ? await window.api.updateAllCards() : await window.api.updateMissingCards();
        if (result.success) { alert(`${result.updatedCount} Karten aktualisiert.`); loadCollection(); }
        else alert("Fehlgeschlagen: " + result.error);
    } catch (e) { alert("Update fehlgeschlagen."); }
    finally { setLocalUpdating(false); setUpdateProgress(null); }
  };

  const groupedCards = useMemo(() => {
      const groups = {};
      rawCards.forEach(card => {
          if (!groups[card.id]) {
              groups[card.id] = {
                  ...card, quantity: 0, totalValue: 0, variants: [], maxPrice: 0, newestDate: new Date(0), sets: new Set(), languages: new Set(), rarities: new Set(), conditions: new Set(), editions: new Set(), nonstandard: 0
              };
          }
          const g = groups[card.id];
          g.quantity += (card.quantity || 1);
          g.totalValue += (card.value != null ? card.value : (card.price || 0) * (card.quantity || 1));
          g.nonstandard = (g.nonstandard || 0) + (card.nonstandard || 0);
          (card.conditions || '').split(',').filter(Boolean).forEach(x => g.conditions.add(x));
          (card.editions || '').split(',').filter(Boolean).forEach(x => g.editions.add(x));
          g.variants.push(card);
          if (card.set_code) g.sets.add(card.set_code.split('-')[0]);
          if (card.language) g.languages.add(card.language);
          g.rarities.add(rarityDisplay(card.rarity)); // „2“/„3“/„New“ -> „Unbekannt“ (rarityDisplay)
          if ((card.price || 0) > g.maxPrice) g.maxPrice = card.price || 0;
          const cDate = new Date(card.created_at);
          if (cDate > g.newestDate) g.newestDate = cDate;
      });
      return Object.values(groups);
  }, [rawCards]);

  const { attributes, races, sets, rarities } = useMemo(() => {
      const attrs = new Set(), rcs = new Set(), sts = new Set(), rars = new Set();
      groupedCards.forEach(c => {
          if (c.attribute) attrs.add(c.attribute);
          if (c.race) rcs.add(c.race);
          c.sets.forEach(s => sts.add(s));
          c.rarities.forEach(r => rars.add(r));
      });
      return {
          attributes: Array.from(attrs).sort().map(a => ({ value: a, label: a })),
          races: Array.from(rcs).sort().map(r => ({ value: r, label: r })),
          sets: Array.from(sts).sort().map(s => ({ value: s, label: s })),
          rarities: Array.from(rars).sort().map(r => ({ value: r, label: r }))
      };
  }, [groupedCards]);

  // Zusatz "(n zum Verkauf)" je Passcode auf jeder Kachel, unabhaengig vom Segment.
  const forSaleByCard = useMemo(() => {
      const m = new Map();
      for (const c of (sale.data ? sale.data.copies : [])) if (c.for_sale) m.set(String(c.card_id), (m.get(String(c.card_id)) || 0) + 1);
      return m;
  }, [sale.data]);

  const filtered = useMemo(() => {
      // card_copies-Zeilen ALLER Printings einer Gruppe (groupedCards buendelt einen Passcode --
      // das kann mehrere Printings umfassen). Grundlage fuer den Behaelter/Tag-Filter und die
      // Textsuche in Tags/Notizen, die beide am Exemplar sitzen statt am Printing.
      const copiesOfGroup = (c) => (c.variants || []).flatMap(v => copiesByPrinting[printingKey(v)] || []);
      const copyMatchesContainer = (cp) => filterContainers.length === 0 || (cp.container_id && filterContainers.includes(cp.container_id));
      const copyMatchesTags = (cp) => {
          if (filterTags.length === 0) return true;
          const copyTags = parseTags(cp.tags).map(t => t.toLowerCase());
          return filterTags.some(t => copyTags.includes(t.toLowerCase()));
      };

      const matches = [];
      for (const c of groupedCards) {
        // Fixrunde 1: c ist die gruppierte Kachel (mehrere Drucke desselben Passcodes) -- eine
        // Voreinstellung trifft, wenn IRGENDEIN Druck sie trifft (c.variants), nicht nur der zuerst
        // angetroffene Druck (der auf c selbst durchgereicht waere).
        if (presets.some(p => !matchesPresetGroup(c.variants, p))) continue;

        // ACHTUNG, ECHTE FALLE (Spec B1 §7.4): Diese Liste gruppiert nach Printing (genauer nach
        // Passcode -- eine Gruppe kann mehrere Printings buendeln), Behaelter und Tag sitzen aber
        // am EXEMPLAR (card_copies). Eine Gruppe bleibt daher sichtbar, sobald MINDESTENS EIN
        // lebendes Exemplar eines ihrer Printings BEIDE aktiven Filter zugleich erfuellt (nicht
        // zwei verschiedene Exemplare je einen) -- und der Standort-Chip unten gehoert zu GENAU
        // DIESEM Exemplar, nicht zur Gruppe. Liegen mehrere passende Exemplare in verschiedenen
        // Behaeltern, zeigt die Zeile bewusst nur das erste (Reihenfolge von listCopies:
        // created_at, copy_id) -- die Kachel hat keinen Platz fuer eine zweite Zeile, und die
        // vollstaendige Aufschluesselung steht im Kartendetail (Task 6) einen Klick entfernt.
        let locationCopy = null;
        if (filterContainers.length > 0 || filterTags.length > 0) {
          const match = copiesOfGroup(c).find(cp => copyMatchesContainer(cp) && copyMatchesTags(cp));
          if (!match) continue;
          if (filterContainers.length > 0) locationCopy = match;
        }

        const q = filter.trim().toLowerCase();
        const matchesSearch = !q
            || (c.name && c.name.toLowerCase().includes(q))
            // name_de kommt aus dem Offline-Katalog (get-collection haengt ihn an) -- gespeichert
            // ist nur der englische Name.
            || (c.name_de && c.name_de.toLowerCase().includes(q))
            || (c.id && passcodeMatches(filter, c.id))
            || (c.race && c.race.toLowerCase().includes(q))
            || (c.attribute && c.attribute.toLowerCase().includes(q))
            || Array.from(c.sets).some(s => s.toLowerCase().includes(q))
            || Array.from(c.rarities).some(r => r.toLowerCase().includes(q))
            // Spec B1 §7.4: die Textsuche findet zusaetzlich Tags und Notizen der Exemplare.
            || copiesOfGroup(c).some(cp => parseTags(cp.tags).some(t => t.toLowerCase().includes(q)))
            || copiesOfGroup(c).some(cp => cp.note && cp.note.toLowerCase().includes(q));
        if (!matchesSearch) continue;
        if (filterType !== 'All' && (!c.type || !c.type.includes(filterType))) continue;
        if (filterAttribute !== 'All' && c.attribute !== filterAttribute) continue;
        if (filterRace !== 'All' && c.race !== filterRace) continue;
        if (filterSet !== 'All' && !Array.from(c.sets).includes(filterSet)) continue;
        if (filterLang !== 'All' && !Array.from(c.languages).includes(filterLang)) continue;
        if (filterRarity !== 'All' && !Array.from(c.rarities).includes(filterRarity)) continue;
        if (filterCondition !== 'All' && !c.conditions.has(filterCondition)) continue;
        if (filterEdition !== 'All' && !c.editions.has(filterEdition)) continue;

        matches.push(locationCopy ? { ...c, _locationCopy: locationCopy } : c);
      }
      return matches.sort((a, b) => {
          switch (sortType) {
              case 'name': return (a.name || '').localeCompare(b.name || '');
              case 'total': return b.totalValue - a.totalValue;
              case 'price': return b.maxPrice - a.maxPrice;
              case 'atk': return (b.atk || 0) - (a.atk || 0);
              case 'def': return (b.def || 0) - (a.def || 0);
              case 'level': return (b.level || 0) - (a.level || 0);
              case 'newest': return b.newestDate - a.newestDate;
              default: return 0;
          }
      });
  }, [groupedCards, filter, filterType, filterAttribute, filterRace, filterSet, filterLang, filterRarity, filterCondition, filterEdition, sortType, presets, filterContainers, filterTags, copiesByPrinting]);

  // Spec F1 §4: der Export-Dialog bekommt den aktuellen Filter als Exemplar-IDs (Stand beim Öffnen).
  const openExport = () => setExportCopyIds(filterCopyIds(filtered, copiesByPrinting, {
    lang: filterLang, rarity: filterRarity, set: filterSet, condition: filterCondition, edition: filterEdition,
    containers: filterContainers, tags: filterTags,
  }));

  const toggleContainerFilter = (id) => setFilterContainers(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const toggleTagFilter = (t) => setFilterTags(list => list.includes(t) ? list.filter(x => x !== t) : [...list, t]);

  // Which filters are set, as removable chips.
  const activeFilters = [
    filterType !== 'All' && { key: 'type', label: filterType, clear: () => setFilterType('All') },
    filterLang !== 'All' && { key: 'lang', label: filterLang, clear: () => setFilterLang('All') },
    filterAttribute !== 'All' && { key: 'attr', label: filterAttribute, clear: () => setFilterAttribute('All') },
    filterRace !== 'All' && { key: 'race', label: filterRace, clear: () => setFilterRace('All') },
    filterRarity !== 'All' && { key: 'rarity', label: filterRarity, clear: () => setFilterRarity('All') },
    filterCondition !== 'All' && { key: 'cond', label: `Zustand ${filterCondition}`, clear: () => setFilterCondition('All') },
    filterEdition !== 'All' && { key: 'ed', label: EDITION_LABELS[filterEdition] || filterEdition, clear: () => setFilterEdition('All') },
    filterSet !== 'All' && { key: 'set', label: filterSet, clear: () => setFilterSet('All') },
  ].filter(Boolean).concat(
    filterContainers.map(id => ({
      key: `container-${id}`,
      label: containers.find(ct => ct.container_id === id)?.name || id,
      clear: () => toggleContainerFilter(id),
    })),
    filterTags.map(t => ({ key: `tag-${t}`, label: t, clear: () => toggleTagFilter(t) })),
    presets.map(id => ({
      key: `preset-${id}`,
      label: PRESETS.find(p => p.id === id)?.label || id,
      clear: () => togglePreset(id),
    })),
  );

  // Mehrfachauswahl (Spec I §5.1, Plan 2026-09-26): Auswahl-Modus per Knopf oder Strg+Klick, Esc hebt auf.
  // Gezählt werden nur SICHTBARE gewählte Karten; die Exemplare kommen aus listSaleCopies (dort steht for_sale).
  const toast = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [selling, setSelling] = useState(null);
  const [moving, setMoving] = useState(null);
  const endSelection = useCallback(() => { setSelectMode(false); setSelected(new Set()); }, []);
  const toggleSelect = (card) => setSelected((s) => {
    const n = new Set(s); const id = String(card.id);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const visibleSelected = useMemo(() => filtered.filter((c) => selected.has(String(c.id))), [filtered, selected]);
  const selCopies = useMemo(() => selectionCopies(visibleSelected.map((c) => ({ ...c, id: String(c.id) })),
    visibleSelected.map((c) => String(c.id)), sale.data?.copies || [], filterContainers), [visibleSelected, sale.data, filterContainers]);
  useEffect(() => {
    if (!selectMode || selling || moving) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') endSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode, selling, moving, endSelection]);
  const onTileClick = (card, e) => {
    if (selectMode || e?.ctrlKey || e?.metaKey) { setSelectMode(true); toggleSelect(card); return; }
    openCard(card);
  };
  const onMoved = ({ moved, text }) => {
    setMoving(null);
    endSelection();
    window.dispatchEvent(new Event('collection-dirty'));
    toast.show({ text, action: moved.length === 0 ? null : { label: 'Rückgängig', run: () => {
      window.api.restoreCopyLocations(moved).then((r) => {
        if (!r?.success) toast.show({ text: r?.error || 'Rückgängig fehlgeschlagen.' });
        window.dispatchEvent(new Event('collection-dirty'));
      });
    } } });
  };

  // The panel walks the list with the arrow buttons, so it gets the current order handed over.
  const openCard = (card) => {
    const first = (card.variants && card.variants[0]) || card;
    const list = filtered.map(c => cardRoute((c.variants && c.variants[0]) || c));
    navigate(cardRoute(first), { state: { background: location, list } });
  };

  const clearFilters = () => {
      setFilter(''); setFilterType('All'); setFilterAttribute('All'); setFilterRace('All'); setFilterSet('All'); setFilterLang('All'); setFilterRarity('All'); setFilterCondition('All'); setFilterEdition('All');
      setFilterContainers([]); setFilterTags([]); setPresets([]);
  };

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
        <div className="flex flex-col gap-4 mb-4 bg-surface p-4 rounded-xl border border-line shrink-0">
            <CollectionToolbar t={{ filter, setFilter, sortType, setSortType, setFiltersOpen, filtersOpen, activeFilters, openExport, exportCopyIds, setExportCopyIds, setPricesOpen, pricesOpen, runBulk, cmBulkBusy, cmRunning, cmProgress, runCardmarket, cmAuto, toggleCmAuto, cmMinRank, setCmMinRank, handleUpdate, updating, cmStatus, relTime, containersTagsError, copiesLoadError, count: filtered.length, selectMode, toggleSelectMode: () => (selectMode ? endSelection() : setSelectMode(true)) }} />
            <CollectionFilters f={{ filtersOpen, presets, togglePreset, filterType, setFilterType, filterLang, setFilterLang, filterAttribute, setFilterAttribute, attributes, filterRace, setFilterRace, races, filterRarity, setFilterRarity, rarities, filterCondition, setFilterCondition, filterEdition, setFilterEdition, filterSet, setFilterSet, sets, clearFilters, containers, filterContainers, toggleContainerFilter, tagOptions, filterTags, toggleTagFilter, activeFilters }} />
        </div>

        <div className="flex-1 overflow-hidden">
            {filtered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted">Keine Karten gefunden.</div>
            ) : (
                <CollectionGrid items={filtered} containers={containers} filterContainers={filterContainers}
                    forSaleByCard={forSaleByCard} onOpen={onTileClick} selectMode={selectMode} selected={selected} />
            )}
        </div>
        {selectMode && (
            <SelectionBar cards={visibleSelected.length} copies={selCopies.length}
                onSelectAll={() => setSelected(new Set(filtered.map((c) => String(c.id))))}
                onSell={() => setSelling({ copies: selCopies, subtitle: sellSubtitle(visibleSelected.length, selCopies.length) })}
                onMove={() => setMoving(selCopies.map((c) => c.copy_id))}
                onCancel={endSelection} />
        )}
        {selling && (
            <SellFlowDialog title="" subtitle={selling.subtitle} copies={selling.copies}
                onClose={() => { setSelling(null); window.dispatchEvent(new Event('collection-dirty')); }} />
        )}
        {moving && <MoveDialog copyIds={moving} containers={containers} onClose={() => setMoving(null)} onMoved={onMoved} />}
    </div>
  );
}
