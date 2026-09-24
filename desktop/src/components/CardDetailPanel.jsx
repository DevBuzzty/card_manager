import { ChevronUp, ChevronDown, X, Minus, Plus, Trash2 } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import CustomSelect from './CustomSelect';
import Flag from './Flag';
import CopySheet from './CopySheet';
import PriceHistoryChart from './PriceHistoryChart';
import PriceAlertTargets from './PriceAlertTargets';
import { groupCopies, valueOf, firstEdLine, CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { parseTags } from '../utils/tags';
import { fmtEUR } from '../utils/format';
import { printingFromParams, cardRoute, ROUTES } from '../utils/routes';
import { T } from '../utils/i18n-de';
import { copyRow, MARK_LABELS } from '../utils/copyRow';
import { formatPasscode } from '../utils/passcode';
import { euroCentsText, toCents } from '../utils/saleMath';
import { createLatestOnly } from '../utils/busyGate';
import { offeredText } from '../utils/listingText';

export default function CardDetailPanel({ paletteOpen = false }) {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const printing = printingFromParams(params);
  const list = location.state?.list || [];          // ordered card routes of the list behind us
  const [card, setCard] = useState(null);           // { …first row, variants: [rows of this passcode] }
  const [localVariants, setLocalVariants] = useState([]);
  const [availableSets, setAvailableSets] = useState([]);
  const [selectedNewSet, setSelectedNewSet] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [copiesByKey, setCopiesByKey] = useState({}); // "set|rarity|lang" -> [copy rows]
  const [containers, setContainers] = useState([]); // fuer den Standort-Chip -- Name/Art je Behaelter
  const [sheetCopy, setSheetCopy] = useState(null); // das im Exemplar-Sheet geoeffnete Exemplar, oder null
  const [sold, setSold] = useState([]); // Spec H2 §7: verkaufte Exemplare dieser Karte
  const soldSeq = useRef(createLatestOnly()); // eine spaete Antwort fuer Karte A landet nie bei Karte B
  const [offers, setOffers] = useState({}); // Spec H3a §6: copy_id -> aktive Angebote ("angeboten auf …")
  const offersSeq = useRef(createLatestOnly());
  const vKey = (v) => `${v.set_code}|${v.rarity}|${v.language || 'DE'}`;
  const printingOf = (v) => ({ id: String(card.id), set_code: v.set_code, language: v.language || 'DE', rarity: v.rarity });

  // Spec H2 §7 -- „Verkauft"-Abschnitt; nur die zuletzt gestartete Abfrage darf setzen.
  const loadSold = (cardId) => {
    if (!window.api?.cardSales) return;
    const token = soldSeq.current.start();
    const apply = (r) => { if (soldSeq.current.isCurrent(token)) setSold(Array.isArray(r) ? r : []); };
    window.api.cardSales(cardId).then(apply).catch(() => apply([]));
  };
  // Spec H3a §6 -- "angeboten auf <Kanal> für <Preis>" je Exemplar; nur die zuletzt gestartete Abfrage darf setzen.
  const loadOffers = () => {
    if (!window.api?.listingOffers) return;
    const token = offersSeq.current.start();
    const apply = (o) => { if (offersSeq.current.isCurrent(token)) setOffers(o || {}); };
    window.api.listingOffers().then(apply).catch(() => apply({}));
  };

  // Rebuild the grouped card for this passcode from the collection.
  const loadCard = async () => {
    if (!window.api) return;
    loadSold(printing.id);
    loadOffers();
    const rows = (await window.api.getCollection()).filter(r => String(r.id) === String(printing.id));
    if (rows.length === 0) { setCard(null); return; }
    const primary = rows.find(r => r.set_code === printing.set_code && r.rarity === printing.rarity
      && (r.language || 'DE') === printing.language) || rows[0];
    setCard({ ...primary, variants: rows });
  };
  useEffect(() => { loadCard(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [params.id]);
  // Verkauf/Storno/Abgleich an anderer Stelle: „Verkauft" frisch halten.
  // Spec H3a §6: dazu Angebote (Abgleich, 'listings-dirty') fuer "angeboten auf …".
  // Spec I §5.2 Punkt 3/4: auch die Exemplare selbst -- ein Storno ueber die Rueckgaengig-Leiste (oder ein
  // Verkauf aus einem anderen Fenster) aendert sie, ohne dass dieses Panel davon weiss. Verschmolzen, weil
  // ein eigener Schreibvorgang mehrere Ereignisse ausloest; loadCard feuert selbst keins (keine Schleife).
  const reloadTimer = useRef(null);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);
  useEffect(() => {
    const onChange = () => {
      loadSold(printing.id); loadOffers();
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { loadCard(); }, 150);
    };
    const off = window.api?.onSalesChanged?.(onChange);
    const offListings = window.api?.onListingsChanged?.(onChange);
    window.addEventListener('collection-dirty', onChange);
    window.addEventListener('listings-dirty', onChange);
    return () => {
      off?.(); offListings?.();
      window.removeEventListener('collection-dirty', onChange);
      window.removeEventListener('listings-dirty', onChange);
    };
  }, [printing.id]); // eslint-disable-line react-hooks/exhaustive-deps -- loadCard liest nur printing/params, wie der Effekt oben

  // Going back is right when we opened over a page; when /karte/… is the first history entry
  // there is nothing behind it, so fall back to the collection instead of doing nothing.
  const close = useCallback(
    () => (location.state?.background ? navigate(-1) : navigate(ROUTES.karten, { replace: true })),
    [navigate, location.state],
  );
  const idx = list.indexOf(cardRoute(printing));
  const goRelative = (delta) => {
    const next = list[idx + delta];
    if (next) navigate(next, { replace: true, state: location.state });
  };

  useEffect(() => {
    // The palette owns Escape while it is open, and so does the CopySheet -- otherwise one press
    // closes it and navigates the panel away in the same keystroke.
    if (paletteOpen || sheetCopy) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, sheetCopy, close]);

  // Fuer den Standort-Chip -- welche Behaelter es gibt und wie sie heissen. window.api fehlt im
  // reinen Browser-Modus; list-containers wirft bei einem DB-Fehler statt {success:false} zu
  // liefern (main.cjs), der Chip faellt dann defensiv auf „—" zurueck statt die Ansicht zu sprengen.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await window.api?.listContainers?.();
        if (alive) setContainers(Array.isArray(c) ? c : []);
      } catch {
        if (alive) setContainers([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const reloadCopies = async (variants) => {
      if (!window.api?.listCopies) return;
      const entries = await Promise.all(variants.map(async v => [vKey(v), await window.api.listCopies(printingOf(v))]));
      setCopiesByKey(Object.fromEntries(entries));
  };
  useEffect(() => { reloadCopies(card?.variants || []); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [card]);

  useEffect(() => { setLocalVariants(card?.variants || []); }, [card]);

  useEffect(() => {
      if (!card || !window.api) return;
      // Full picture across languages: German + Japanese printings come from the wiki+Konami
      // union; English/international from YGOPRODeck. German first, then EN, then JP.
      Promise.all([
          window.api.fetchYugipediaSets(card.id).then(s => s || []).catch(() => []),
          window.api.fetchCardData(card.id).then(d => (d && d.card_sets) || []).catch(() => []),
          window.api.fetchJapaneseSets(card.id).then(s => s || []).catch(() => []),
      ]).then(([deSets, enSets, jpSets]) => {
          const tagged = [
              ...deSets.map(s => ({ ...s, language: 'DE' })),
              ...enSets.map(s => ({ ...s, language: 'EN' })),
              ...jpSets.map(s => ({ ...s, language: 'JP' })),
          ];
          const seen = new Set();
          const merged = [];
          for (const s of tagged) {
              const key = `${s.set_code}|${s.set_rarity}`;
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(s);
          }
          setAvailableSets(merged);
      });
  }, [card]);

  if (!card) return null;

  const removeVariantLocal = (variant) => {
      setLocalVariants(prev => prev.filter(v =>
          !(v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
      ));
      window.dispatchEvent(new Event('collection-dirty'));
  };

  const handleDeleteVariant = async (variant) => {
      const result = await window.api.deleteCard({
          id: card.id,
          set_code: variant.set_code,
          language: variant.language || 'DE',
          rarity: variant.rarity
      });
      if (result.success) removeVariantLocal(variant);
  };

  const changeGroup = async (variant, group, delta) => {
      const p = printingOf(variant);
      if (delta > 0) await window.api.addCopy({ ...p, edition: group.edition, condition: group.condition, count: 1 });
      else await window.api.removeCopy({ ...p, edition: group.edition, condition: group.condition, count: 1 });
      await refreshVariant(variant);
  };
  const addStandardCopy = async (variant) => { await window.api.addCopy(printingOf(variant)); await refreshVariant(variant); };
  const moveGroup = async (variant, group, to) => {
      await window.api.updateCopyGroup({ ...printingOf(variant), from: { edition: group.edition, condition: group.condition }, to });
      await refreshVariant(variant);
  };
  // Re-read one printing's copies; drop the variant locally when it has none left (the trigger tombstoned it).
  const refreshVariant = async (variant) => {
      const rows = await window.api.listCopies(printingOf(variant));
      setCopiesByKey(prev => ({ ...prev, [vKey(variant)]: rows }));
      setLocalVariants(prev => prev.map(v => vKey(v) === vKey(variant) ? { ...v, quantity: rows.length } : v).filter(v => v.quantity > 0));
      window.dispatchEvent(new Event('collection-dirty'));
  };

  const handleAddVariant = async () => {
      if (!selectedNewSet) return;

      setIsAdding(true);

      let setInfo;
      try {
          setInfo = availableSets.find(s => `${s.set_code}|${s.set_rarity}` === selectedNewSet);
          if (!setInfo) throw new Error("Set not found");
      } catch (e) {
          console.error("Failed to parse selected set", e);
          setIsAdding(false);
          return;
      }

      const newVariant = {
          ...card,
          set_code: setInfo.set_code,
          rarity: setInfo.set_rarity,
          price: (parseFloat(setInfo.set_price) || 0),
          language: setInfo.language || 'DE',
          quantity: 1
      };

      const result = await window.api.addCardToDb(newVariant);

      if (result.success) {
          const existingIndex = localVariants.findIndex(v => v.set_code === newVariant.set_code && v.rarity === newVariant.rarity);
          if (existingIndex >= 0) {
              setLocalVariants(prev => prev.map((v, i) =>
                  i === existingIndex ? { ...v, quantity: v.quantity + 1 } : v
              ));
          } else {
              setLocalVariants(prev => [...prev, newVariant]);
          }
          window.dispatchEvent(new Event('collection-dirty'));
          setSelectedNewSet('');
          await reloadCopies([...localVariants, newVariant]);
      }
      setIsAdding(false);
  };

  const isLink = card.type && card.type.includes('Link');
  const isXYZ = card.type && card.type.includes('XYZ');
  const levelLabel = isLink ? 'Link Rating' : (isXYZ ? 'Rank' : 'Level');

  return (
    <>
    <aside className="w-[420px] shrink-0 h-full overflow-y-auto custom-scrollbar bg-bg border-l border-line p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <button onClick={() => goRelative(-1)} disabled={idx <= 0}
          className="p-1.5 rounded-lg bg-surface border border-line text-muted hover:text-text disabled:opacity-30" title="Vorherige Karte">
          <ChevronUp className="w-4 h-4" />
        </button>
        <button onClick={() => goRelative(1)} disabled={idx < 0 || idx >= list.length - 1}
          className="p-1.5 rounded-lg bg-surface border border-line text-muted hover:text-text disabled:opacity-30" title="Nächste Karte">
          <ChevronDown className="w-4 h-4" />
        </button>
        <span className="ml-auto" />
        <button onClick={close} className="p-1.5 rounded-lg bg-surface border border-line text-muted hover:text-text" title={T.zurueck}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <img src={card.image_url} alt={card.name} className="w-full rounded-xl" />

      <div>
          <h2 className="text-2xl font-bold text-text mb-2">{card.name}</h2>
          <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-accent/20 text-text rounded-full text-sm font-medium border border-accent/30">
                  {card.type}
              </span>
              {card.race && (
                   <span className="px-3 py-1 bg-surface-2 text-text rounded-full text-sm font-medium border border-line">
                      {card.race}
                   </span>
              )}
              {card.attribute && (
                   <span className="px-3 py-1 bg-surface-2 text-text rounded-full text-sm font-medium border border-line font-mono">
                      {card.attribute}
                   </span>
              )}
          </div>
      </div>

      {/* Inventory / Variants Section */}
      <div className="bg-surface-2 p-4 rounded-xl border border-line">
          <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold uppercase text-muted">Deine Exemplare</span>
              <span className="text-xs text-muted">Gesamt: {localVariants.reduce((s, v) => s + (v.quantity || 0), 0)}</span>
          </div>

          <div className="space-y-3 mb-4">
              {localVariants.length === 0 && <p className="text-muted text-sm italic">Noch keine Exemplare.</p>}
              {localVariants.map((variant, idx2) => (
                  <div key={idx2} className="flex flex-col gap-2 bg-bg/40 p-2 rounded-lg border border-line">
                      <div className="flex items-start justify-between">
                          <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm text-warn font-bold">{variant.set_code}</span>
                                  <span className="text-xs text-muted border border-line px-1 rounded">{variant.rarity}</span>
                              </div>
                              <span className="text-xs text-accent">{firstEdLine(variant) ?? fmtEUR(variant.price || 0)}</span>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                              <input type="number" step="0.01" min="0" defaultValue={variant.price ?? 0}
                                onBlur={async (e) => {
                                  const price = parseFloat(e.target.value);
                                  if (isNaN(price)) return;
                                  await window.api.setCardPrice({ id: card.id, set_code: variant.set_code, language: variant.language || 'DE', rarity: variant.rarity, price });
                                  window.dispatchEvent(new Event('collection-dirty'));
                                }}
                                className="w-16 bg-bg/40 border border-line rounded px-1 py-0.5 text-xs text-text"
                                title="Preis manuell setzen (überschreibt Auto-Preis)" />
                              {variant.cm_updated_at && !variant.cm_url && (
                                <span className="text-[9px] text-warn" title="Auf Cardmarket nicht eindeutig gefunden">kein CM-Treffer</span>
                              )}
                              <button onClick={() => { if (confirm(`${variant.set_code} (${variant.rarity}) mit allen Exemplaren löschen?`)) handleDeleteVariant(variant); }}
                                  className="p-1.5 bg-bad/10 hover:bg-bad/20 text-text rounded transition-colors" title="Printing löschen">
                                  <Trash2 className="w-3.5 h-3.5" />
                              </button>
                          </div>
                      </div>

                      <PriceHistoryChart key={`${card.id}|${variant.set_code}|${variant.language || 'DE'}|${variant.rarity}`} printing={printingOf(variant)} />

                      <PriceAlertTargets key={`${card.id}|${variant.set_code}|${variant.language || 'DE'}|${variant.rarity}`} printing={printingOf(variant)} />

                      <div>
                          {groupCopies(copiesByKey[vKey(variant)] || []).map(g => {
                              const groupRows = (copiesByKey[vKey(variant)] || [])
                                  .filter(c => (c.edition || 'unknown') === g.edition && (c.condition || 'NM') === g.condition);
                              return (
                              <div key={`${g.edition}|${g.condition}`} className="py-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                  <div className="flex items-center bg-surface rounded border border-line">
                                      <button onClick={() => changeGroup(variant, g, -1)} className="p-1 hover:bg-surface-2 rounded-l text-muted hover:text-text"><Minus className="w-3 h-3" /></button>
                                      <span className="w-8 text-center font-mono text-sm font-bold">{g.count}×</span>
                                      <button onClick={() => changeGroup(variant, g, 1)} className="p-1 hover:bg-surface-2 rounded-r text-muted hover:text-text"><Plus className="w-3 h-3" /></button>
                                  </div>
                                  <select value={g.condition} onChange={e => moveGroup(variant, g, { edition: g.edition, condition: e.target.value })}
                                      className="bg-bg/40 border border-line rounded px-1 py-0.5 text-xs text-text font-mono">
                                      {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <select value={g.edition} onChange={e => moveGroup(variant, g, { edition: e.target.value, condition: g.condition })}
                                      className="bg-bg/40 border border-line rounded px-1 py-0.5 text-xs text-text">
                                      {EDITIONS.map(ed => <option key={ed} value={ed}>{EDITION_LABELS[ed]}</option>)}
                                  </select>
                                  <span className="ml-auto font-mono text-xs text-text">{fmtEUR(valueOf(variant, [g]))}</span>
                              </div>
                              {/* Spec B1 §7.3: je Exemplar der Gruppe eine Zeile mit Standort- und Tag-Chips; ein Klick oeffnet das Exemplar-Sheet. */}
                              <div className="mt-1 space-y-1">
                                  {groupRows.map(c => {
                                      // Spec I §4.1: Zustand · Auflage · Standort, rechts hoechstens zwei Marken.
                                      const offerList = offers[c.copy_id] || [];
                                      const row = copyRow(c, containers.find(ct => ct.container_id === c.container_id), offerList);
                                      return (
                                      <button key={c.copy_id} type="button" onClick={() => setSheetCopy(c)}
                                          className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 rounded-lg bg-bg/20 hover:bg-bg/40 border border-line text-left transition-colors">
                                          <span className="text-xs text-text truncate">
                                              {row.lead} · <span className={row.unsorted ? 'text-muted' : 'text-text'}>{row.location}</span>
                                          </span>
                                          <span className="ml-auto flex items-center gap-1 flex-wrap justify-end">
                                              {row.marks.map(m => (
                                                  <span key={m} title={m === 'angeboten' ? offeredText(offerList) : undefined}
                                                      className={`px-1.5 py-0.5 rounded-full text-[10px] text-text border ${m === 'angeboten' ? 'bg-good/15 border-good/40' : 'bg-warn/15 border-warn/40'}`}>
                                                      {MARK_LABELS[m]}
                                                  </span>
                                              ))}
                                              {parseTags(c.tags).map(t => (
                                                  <span key={t} className="px-1.5 py-0.5 rounded-full bg-accent/15 text-text text-[10px] border border-accent/30">{t}</span>
                                              ))}
                                          </span>
                                      </button>
                                      );
                                  })}
                              </div>
                              </div>
                              );
                          })}
                          <button onClick={() => addStandardCopy(variant)} className="mt-1 text-xs text-muted hover:text-accent flex items-center gap-1">
                              <Plus className="w-3 h-3" /> Exemplar hinzufügen
                          </button>
                      </div>
                  </div>
              ))}
          </div>

          {/* Add New Variant */}
          <div className="pt-3 border-t border-line">
              <label className="text-xs text-muted uppercase font-bold mb-2 block">Weiteres Printing hinzufügen</label>
              <div className="flex flex-col gap-2">
                   <CustomSelect
                        value={selectedNewSet}
                        onChange={setSelectedNewSet}
                        placeholder="Printing wählen…"
                        options={(() => {
                            // Deduplicate sets based on set_code + rarity
                            const unique = new Map();
                            availableSets.forEach(s => {
                                const key = `${s.set_code}|${s.set_rarity}`;
                                if (!unique.has(key)) unique.set(key, s);
                            });

                            const list2 = Array.from(unique.values())
                                .filter(s => !localVariants.some(v => v.set_code === s.set_code && v.rarity === s.set_rarity));
                            return list2.map((set, i) => ({
                                value: `${set.set_code}|${set.set_rarity}`,
                                // Separate the language groups (DE | EN | JP) with a thin divider + spacing.
                                divider: i > 0 && list2[i - 1].language !== set.language,
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Flag lang={set.language} />
                                        {`${set.set_code} - ${set.set_rarity}${set.set_price ? ` ($${set.set_price})` : ''}`}
                                    </span>
                                )
                            }));
                        })()}
                    />
                  <button
                      onClick={handleAddVariant}
                      disabled={!selectedNewSet || isAdding}
                      className="bg-accent hover:brightness-110 text-accent-fg px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                      {isAdding ? 'Füge hinzu…' : 'Hinzufügen'}
                  </button>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
          {/* Level / Rank / Link Rating */}
          {card.level != null && (
              <div className="bg-bg/50 p-3 rounded-lg border border-line">
                  <span className="text-xs text-muted uppercase tracking-wider block mb-1">{levelLabel}</span>
                  <span className="text-xl font-bold text-warn">{isLink ? `LINK-${card.level}` : `★ ${card.level}`}</span>
              </div>
          )}

          {/* ATK */}
          {card.atk != null && (
              <div className="bg-bg/50 p-3 rounded-lg border border-line">
                  <span className="text-xs text-muted uppercase tracking-wider block mb-1">ATK</span>
                  <span className="text-xl font-bold text-bad">{card.atk}</span>
              </div>
          )}

           {/* DEF (Hide if Link) */}
           {!isLink && card.def != null && (
              <div className="bg-bg/50 p-3 rounded-lg border border-line">
                  <span className="text-xs text-muted uppercase tracking-wider block mb-1">DEF</span>
                  <span className="text-xl font-bold text-accent">{card.def}</span>
              </div>
          )}

           {/* Passcode */}
          <div className="bg-bg/50 p-3 rounded-lg border border-line">
              <span className="text-xs text-muted uppercase tracking-wider block mb-1">Passcode</span>
              {/* Achtstellig, wie auf der Karte gedruckt -- intern steht er ohne fuehrende Nullen. */}
              <span className="text-xl font-mono text-text">{formatPasscode(card.id)}</span>
          </div>
      </div>

      {sold.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-text mb-2">Verkauft</h3>
          <div className="space-y-1">
            {sold.map((s) => (
              <div key={`${s.sale_id}|${s.copy_id}`} className={`flex items-center gap-2 text-[11px] font-mono ${s.status === 'storniert' ? 'line-through text-muted' : 'text-muted'}`}>
                <span>{s.sold_on.split('-').reverse().join('.')}</span><span>{s.channel_name}</span>
                <span>{s.set_code} · {s.rarity} · {s.condition}</span>
                <span className="ml-auto text-text">{euroCentsText(toCents(s.share))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="prose prose-invert max-w-none">
          <h3 className="text-lg font-semibold text-text mb-2">Beschreibung</h3>
          <p className="text-muted leading-relaxed whitespace-pre-wrap font-serif text-base bg-bg/20 p-4 rounded-lg border border-line max-h-[200px] overflow-y-auto custom-scrollbar">
              {card.desc}
          </p>
      </div>
    </aside>

    {sheetCopy && (
        <CopySheet
            key={sheetCopy.copy_id}
            copy={sheetCopy}
            cardName={card.name}
            // Spec I §5.2 Punkt 5: "Naechstes Exemplar" -- weitere vorgemerkte Exemplare derselben Karte.
            siblings={Object.values(copiesByKey).flat().filter(c => c.for_sale && c.copy_id !== sheetCopy.copy_id)}
            onOpenCopy={(c) => setSheetCopy(c)}
            onClose={() => setSheetCopy(null)}
            onSaved={() => { refreshVariant({ set_code: sheetCopy.set_code, rarity: sheetCopy.rarity, language: sheetCopy.language }); loadSold(printing.id); loadOffers(); }}
        />
    )}
    </>
  );
}
