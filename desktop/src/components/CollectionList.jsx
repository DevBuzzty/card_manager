import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, LayoutGrid, List as ListIcon, FilterX, SlidersHorizontal, Coins, X, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { Grid } from 'react-window';
import CustomSelect from './CustomSelect';
import CardTile from './CardTile';
import { getRarityInfo } from '../utils/rarity.js';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { cardRoute } from '../utils/routes';
import { parseTags } from '../utils/tags';
import { formatCopyLocation } from '../utils/copyLocation';

// Simple AutoSizer replacement
const AutoSizer = ({ children }) => {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!ref.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        resizeObserver.observe(ref.current);
        return () => resizeObserver.disconnect();
    }, []);

    return (
        <div ref={ref} style={{ width: '100%', height: '100%' }}>
            {size.width > 0 && size.height > 0 && children(size)}
        </div>
    );
};

// Width of a scrollbar in this build, measured once. index.css styles it (8px today), so
// reading it off the page beats repeating the number here.
let sbWidth = null;
const scrollbarWidth = () => {
    if (sbWidth == null) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll';
        document.body.appendChild(probe);
        sbWidth = probe.offsetWidth - probe.clientWidth;
        probe.remove();
    }
    return sbWidth;
};

// Spec B1 §7.4: card_copies kommt ueber listCopies() je Printing herein -- derselbe vierteilige
// Schluessel wie ueberall sonst im Projekt (id/set_code/language/rarity).
const printingKey = (p) => `${p.id}|${p.set_code}|${p.language || 'DE'}|${p.rarity}`;

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
  const [segment, setSegment] = useState('all'); // all | unknown | incomplete | foils
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [cmRunning, setCmRunning] = useState(false);
  const [cmProgress, setCmProgress] = useState(null);
  const [cmMinRank, setCmMinRank] = useState(5); // default: from Secret Rare up (skip cheap commons)
  const [cmAuto, setCmAuto] = useState(false); // background auto-refresh toggle
  const [cmBulkBusy, setCmBulkBusy] = useState(false);
  const [cmStatus, setCmStatus] = useState(null); // { lastRun, resolvedCount, unresolvedCount }

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
          if (card.rarity) g.rarities.add(card.rarity);
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

  // A grouped card is "incomplete" if a monster is missing atk/def/level, or anything lacks an image.
  const isIncomplete = (c) => {
      const isMonster = c.type && !c.type.includes('Spell') && !c.type.includes('Trap');
      const isLink = c.type && c.type.includes('Link');
      if (isMonster) {
          if (c.atk == null) return true;
          if (!isLink && c.def == null) return true;
          if (c.level == null) return true;
          return false;
      }
      return !c.image_url;
  };
  const hasUnknownVariant = (c) => c.variants && c.variants.some(v => v.set_code === 'Unknown');
  const hasFoilVariant = (c) => Array.from(c.rarities).some(r => !!getRarityInfo(r).foil);

  const segmentCounts = useMemo(() => ({
      all: groupedCards.length,
      unknown: groupedCards.filter(hasUnknownVariant).length,
      incomplete: groupedCards.filter(isIncomplete).length,
      foils: groupedCards.filter(hasFoilVariant).length,
  }), [groupedCards]);

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
        if (segment === 'unknown' && !hasUnknownVariant(c)) continue;
        if (segment === 'incomplete' && !isIncomplete(c)) continue;
        if (segment === 'foils' && !hasFoilVariant(c)) continue;

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
            || (c.id && String(c.id).includes(filter.trim()))
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
  }, [groupedCards, filter, filterType, filterAttribute, filterRace, filterSet, filterLang, filterRarity, filterCondition, filterEdition, sortType, segment, filterContainers, filterTags, copiesByPrinting]);

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
  );

  // The panel walks the list with the arrow buttons, so it gets the current order handed over.
  const openCard = (card) => {
    const first = (card.variants && card.variants[0]) || card;
    const list = filtered.map(c => cardRoute((c.variants && c.variants[0]) || c));
    navigate(cardRoute(first), { state: { background: location, list } });
  };

  const clearFilters = () => {
      setFilter(''); setFilterType('All'); setFilterAttribute('All'); setFilterRace('All'); setFilterSet('All'); setFilterLang('All'); setFilterRarity('All'); setFilterCondition('All'); setFilterEdition('All');
      setFilterContainers([]); setFilterTags([]);
  };

  // Virtualized Grid Cell Renderer
  const Cell = ({ columnIndex, rowIndex, style, ...props }) => {
      // In this version of react-window, data is passed via props merged from cellProps?
      // Wait, .d.ts says: cellComponent receives (props: { ... } & CellProps)
      // So items and columnCount should be in props directly if I pass them in cellProps.

      const { items, columnCount } = props;
      // Note: columnIndex and rowIndex are also in props.

      const index = rowIndex * columnCount + columnIndex;
      if (index >= items.length) return null;
      const card = items[index];
      // Spec B1 §7.4: der Chip gehoert zum EXEMPLAR, das den aktiven Behaelterfilter erfuellt hat
      // (card._locationCopy, siehe filtered oben), nicht zum Printing -- deshalb hier und nicht
      // in CardTile.jsx (das kennt keine Exemplare, nur aggregierte Printing-Zeilen).
      const locationCopy = card._locationCopy;
      const locationContainer = locationCopy ? containers.find(ct => ct.container_id === locationCopy.container_id) : null;

      return (
          <div style={{ ...style, padding: 8 }}>
              <CardTile card={card} onClick={() => openCard(card)} />
              {filterContainers.length > 0 && locationCopy && (
                  <div className="mt-1 px-0.5">
                      <span className="inline-flex items-center font-mono text-[9.5px] text-ink-faint bg-obsidian-700 border border-line rounded px-1.5 py-0.5 truncate max-w-full">
                          {formatCopyLocation(locationCopy, locationContainer)}
                      </span>
                  </div>
              )}
          </div>
      );
  };

  const runUnknownAction = async (kind) => {
      if (!window.api || segmentBusy) return;
      const msg = kind === 'merge'
          ? "Alle 'Unbekannt'-Karten in ihre häufigste vorhandene Set-Variante zusammenführen?"
          : "Alle 'Unbekannt'-Karten auf ihr günstigstes verfügbares Set setzen (online, kann dauern)?";
      if (!confirm(msg)) return;
      setSegmentBusy(true);
      try {
          const res = kind === 'merge' ? await window.api.mergeUnknownCards() : await window.api.convertUnknownsToDefault();
          if (res.success) { alert(kind === 'merge' ? `${res.merged} Karten zusammengeführt.` : `${res.converted} Karten umgestellt.`); loadCollection(); }
          else alert('Fehlgeschlagen: ' + res.error);
      } catch { alert('Aktion fehlgeschlagen.'); }
      finally { setSegmentBusy(false); }
  };

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
        <div className="flex flex-col gap-4 mb-4 bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 shrink-0">
            {/* Row 1: count, search, sort, filter toggle, prices menu */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-ink-muted text-sm shrink-0">{filtered.length} Karten</span>
                <div className="relative group flex-1 min-w-[220px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                    <input type="text" placeholder="Suchen…" className="bg-obsidian border border-line text-ink pl-10 pr-4 py-2 rounded-lg w-full focus:border-space-violet outline-none"
                           value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
                <CustomSelect value={sortType} onChange={setSortType} placeholder="Sortierung" className="w-[170px]" options={[
                    { value: 'newest', label: 'Neueste' }, { value: 'total', label: 'Wert (gesamt)' }, { value: 'price', label: 'Preis (einzeln)' },
                    { value: 'name', label: 'Name' }, { value: 'atk', label: 'ATK' }, { value: 'def', label: 'DEF' }, { value: 'level', label: 'Level' }]} />
                <button onClick={() => setFiltersOpen(o => !o)}
                        className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
                          filtersOpen || activeFilters.length ? 'bg-space-violet/15 border-space-violet/40 text-ink' : 'bg-obsidian-700 border-line text-ink-muted hover:text-ink')}>
                    <SlidersHorizontal className="w-4 h-4" /> Filter
                    {activeFilters.length > 0 && <span className="font-mono text-[10px] bg-space-violet text-white rounded-full px-1.5">{activeFilters.length}</span>}
                </button>
                <div className="relative">
                    <button onClick={() => setPricesOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-obsidian-700 border border-line text-ink-muted hover:text-ink">
                        <Coins className="w-4 h-4" /> Preise
                    </button>
                    {pricesOpen && (
                      <div className="absolute right-0 top-11 z-30 w-[320px] bg-obsidian-800 border border-line rounded-xl shadow-2xl p-3 space-y-2"
                           onMouseLeave={() => setPricesOpen(false)}>
                        <button onClick={runBulk} disabled={cmBulkBusy || cmRunning}
                                className="w-full text-left px-3 py-2 rounded-lg bg-space-violet/80 hover:bg-space-violet text-white text-sm disabled:opacity-50">
                          {cmBulkBusy ? 'Aktualisiere…' : 'Jetzt aktualisieren (Preisdatei)'}
                        </button>
                        <button onClick={cmRunning ? () => window.api.abortCardmarketScrape() : runCardmarket}
                                className="w-full text-left px-3 py-2 rounded-lg bg-obsidian-700 border border-line text-ink text-sm hover:border-space-violet/40">
                          {cmRunning ? `Abbrechen${cmProgress ? ` (${cmProgress.current}/${cmProgress.total})` : ''}` : 'Rest scrapen'}
                        </button>
                        <label className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted cursor-pointer select-none">
                          <input type="checkbox" checked={cmAuto} onChange={toggleCmAuto} className="accent-space-violet" />
                          Automatisch im Hintergrund
                        </label>
                        <div className="px-3">
                          <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">Ab Rarity</div>
                          <select value={cmMinRank} onChange={(e) => { const v = Number(e.target.value); setCmMinRank(v); if (cmAuto) window.api?.saveSetting?.({ key: 'cm_auto_min_rank', value: String(v) }); }}
                                  className="w-full px-2 py-1.5 rounded bg-obsidian border border-line text-ink text-sm">
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
                          <button onClick={() => handleUpdate('missing')} disabled={updating} className="text-sm text-ink-muted hover:text-ink">Fehlende Daten holen</button>
                          <button onClick={() => handleUpdate('all')} disabled={updating} className="block text-sm text-ink-muted hover:text-ink">Alle Karten aktualisieren</button>
                          {cmStatus && (
                            <div className="text-[11px] text-ink-faint pt-1">
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
                Binders.jsx (roter crit-Kasten mit Symbol). */}
            {containersTagsError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-crit/40 bg-crit/10 text-sm text-crit">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{containersTagsError}</span>
                </div>
            )}
            {copiesLoadError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-crit/40 bg-crit/10 text-sm text-crit">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{copiesLoadError}</span>
                </div>
            )}

            {/* Row 2: segment control */}
            <div className="flex flex-wrap items-center gap-2">
                {[
                    { id: 'all', label: 'Alle' },
                    { id: 'unknown', label: 'Unbekannt' },
                    { id: 'incomplete', label: 'Unvollständig' },
                    { id: 'foils', label: 'Foils' },
                ].map(s => (
                    <button
                        key={s.id}
                        onClick={() => setSegment(s.id)}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-display text-xs font-medium transition-colors ${
                            segment === s.id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'bg-obsidian-700 text-ink-muted hover:text-ink border border-line'
                        }`}
                    >
                        {s.label}
                        <span className={`font-mono text-[9.5px] px-1.5 rounded-full ${segment === s.id ? 'bg-black/25' : 'bg-black/30'}`}>{segmentCounts[s.id]}</span>
                    </button>
                ))}
            </div>

            {/* Unknown batch actions */}
            {segment === 'unknown' && segmentCounts.unknown > 0 && (
                <div className="flex items-center gap-3 bg-gold/5 border border-gold/25 rounded-xl px-4 py-3">
                    <span className="text-xs text-ink-muted flex-1">Diesen Karten fehlt der Set-Code — auflösen, damit der Wert stimmt.</span>
                    <button onClick={() => runUnknownAction('convert')} disabled={segmentBusy} className="px-3 py-1.5 bg-obsidian-600 hover:bg-obsidian-700 text-ink rounded-lg text-xs font-medium border border-line disabled:opacity-50">Auf Standard-Set setzen</button>
                    <button onClick={() => runUnknownAction('merge')} disabled={segmentBusy} className="px-3 py-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg text-xs font-medium disabled:opacity-50">{segmentBusy ? 'Läuft…' : 'Alle zusammenführen'}</button>
                </div>
            )}

            {/* Row 3: filter dropdowns, only when open */}
            {filtersOpen && (
              <div className="flex flex-wrap items-center gap-3">
                  <CustomSelect value={filterType} onChange={setFilterType} placeholder="Typ" className="w-[120px]" options={[{ value: "All", label: "Typ" }, { value: "Monster", label: "Monster" }, { value: "Spell", label: "Spell" }, { value: "Trap", label: "Trap" }, { value: "Link", label: "Link" }, { value: "XYZ", label: "XYZ" }, { value: "Synchro", label: "Synchro" }, { value: "Fusion", label: "Fusion" }]} />
                  <CustomSelect value={filterLang} onChange={setFilterLang} placeholder="Sprache" className="w-[90px]" options={[{ value: "All", label: "Sprache" }, { value: "DE", label: "DE" }, { value: "EN", label: "EN" }, { value: "JP", label: "JP" }]} />
                  <CustomSelect value={filterAttribute} onChange={setFilterAttribute} placeholder="Attribut" className="w-[120px]" options={[{ value: "All", label: "Attribut" }, ...attributes]} />
                  <CustomSelect value={filterRace} onChange={setFilterRace} placeholder="Rasse/Typ" className="w-[130px]" options={[{ value: "All", label: "Rasse/Typ" }, ...races]} />
                  <CustomSelect value={filterRarity} onChange={setFilterRarity} placeholder="Rarity" className="w-[130px]" options={[{ value: "All", label: "Rarity" }, ...rarities]} />
                  <CustomSelect value={filterCondition} onChange={setFilterCondition} placeholder="Zustand" className="w-[110px]" options={[{ value: 'All', label: 'Zustand' }, ...CONDITIONS.map(c => ({ value: c, label: c }))]} />
                  <CustomSelect value={filterEdition} onChange={setFilterEdition} placeholder="Edition" className="w-[120px]" options={[{ value: 'All', label: 'Edition' }, ...EDITIONS.map(e => ({ value: e, label: EDITION_LABELS[e] }))]} />
                  <CustomSelect value={filterSet} onChange={setFilterSet} placeholder="Set" className="w-[120px]" options={[{ value: "All", label: "Set" }, ...sets]} />
                  <button onClick={clearFilters} title="Filter zurücksetzen" className="p-2 text-gray-500 hover:text-red-400"><FilterX className="w-4 h-4" /></button>
              </div>
            )}

            {/* Row 3b: Behaelter- und Tag-Filter (Spec B1 §7.4) -- beide mehrfach waehlbar, deshalb
                Toggle-Chips statt CustomSelect (das ist Einfachauswahl). */}
            {filtersOpen && containers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint mr-1 shrink-0">Behälter</span>
                  {containers.map(ct => (
                      <button key={ct.container_id} type="button" onClick={() => toggleContainerFilter(ct.container_id)}
                              className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors',
                                filterContainers.includes(ct.container_id) ? 'bg-space-violet/20 border-space-violet/50 text-ink' : 'bg-obsidian-700 border-line text-ink-muted hover:text-ink')}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ct.color || '#6b6383' }} />
                          {ct.name}
                      </button>
                  ))}
              </div>
            )}
            {filtersOpen && tagOptions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint mr-1 shrink-0">Tags</span>
                  {tagOptions.map(t => (
                      <button key={t} type="button" onClick={() => toggleTagFilter(t)}
                              className={clsx('px-2.5 py-1 rounded-full text-xs border transition-colors',
                                filterTags.includes(t) ? 'bg-space-violet/20 border-space-violet/50 text-ink' : 'bg-obsidian-700 border-line text-ink-muted hover:text-ink')}>
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
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-space-violet/15 border border-space-violet/30 text-ink text-xs">
                    {f.label} <X className="w-3 h-3 opacity-60" />
                  </button>
                ))}
                <button onClick={clearFilters} className="text-xs text-ink-faint hover:text-crit">Alle entfernen</button>
              </div>
            )}
        </div>

        <div className="flex-1 overflow-hidden">
            {filtered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-600">Keine Karten gefunden.</div>
            ) : (
                <AutoSizer>
                    {({ height, width }) => {
                        // The Grid's own vertical scrollbar sits inside the width AutoSizer
                        // measured. Columns spread across the full width would push the last one
                        // underneath it and make the Grid scroll sideways, so lay them out
                        // across what the scrollbar leaves over.
                        const inner = Math.max(width - scrollbarWidth(), 0);
                        // Responsive Column Count
                        const columnWidth = 180;
                        const columnCount = Math.floor(inner / columnWidth) || 1;
                        const rowCount = Math.ceil(filtered.length / columnCount);

                        return (
                            <Grid
                                columnCount={columnCount}
                                columnWidth={inner / columnCount}
                                defaultHeight={height}
                                rowCount={rowCount}
                                rowHeight={300}
                                width={width}
                                height={height} // Also pass height for Grid style
                                cellProps={{ items: filtered, columnCount }}
                                cellComponent={Cell}
                            />
                        );
                    }}
                </AutoSizer>
            )}
        </div>
    </div>
  );
}
