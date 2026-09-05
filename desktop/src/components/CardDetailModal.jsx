import { X, Minus, Plus, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';
import Flag from './Flag';
import { groupCopies, valueOf, CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { fmtEUR } from '../utils/format';

export default function CardDetailModal({ card, onClose }) {
  const [localVariants, setLocalVariants] = useState(card.variants || []);
  const [availableSets, setAvailableSets] = useState([]);
  const [selectedNewSet, setSelectedNewSet] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [copiesByKey, setCopiesByKey] = useState({}); // "set|rarity|lang" -> [copy rows]
  const vKey = (v) => `${v.set_code}|${v.rarity}|${v.language || 'DE'}`;
  const printingOf = (v) => ({ id: String(card.id), set_code: v.set_code, language: v.language || 'DE', rarity: v.rarity });

  const reloadCopies = async (variants) => {
      if (!window.api?.listCopies) return;
      const entries = await Promise.all(variants.map(async v => [vKey(v), await window.api.listCopies(printingOf(v))]));
      setCopiesByKey(Object.fromEntries(entries));
  };
  useEffect(() => { reloadCopies(card.variants || []); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [card]);

  useEffect(() => {
      setLocalVariants(card.variants || []);
      if (window.api) {
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
      }
  }, [card]);

  if (!card) return null;

  const removeVariantLocal = (variant) => {
      setLocalVariants(prev => prev.filter(v =>
          !(v.set_code === variant.set_code && v.rarity === variant.rarity && v.language === variant.language)
      ));
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
          setSelectedNewSet('');
          await reloadCopies([...localVariants, newVariant]);
      }
      setIsAdding(false);
  };

  const isLink = card.type && card.type.includes('Link');
  const isXYZ = card.type && card.type.includes('XYZ');
  const levelLabel = isLink ? 'Link Rating' : (isXYZ ? 'Rank' : 'Level');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-[#1E1E1E] w-full max-w-4xl max-h-[90vh] rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>

        {/* Left: Image */}
        <div className="w-full md:w-1/3 bg-black flex items-center justify-center p-6 border-b md:border-b-0 md:border-r border-gray-700">
           <img
             src={card.image_url}
             alt={card.name}
             className="max-w-full max-h-[60vh] object-contain shadow-[0_0_30px_rgba(157,0,255,0.2)] rounded-lg"
           />
        </div>

        {/* Right: Details */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar flex flex-col">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-3xl font-bold text-space-white mb-2">{card.name}</h2>
                    <div className="flex flex-wrap gap-2">
                        <span className="px-3 py-1 bg-space-violet/20 text-space-violet rounded-full text-sm font-medium border border-space-violet/30">
                            {card.type}
                        </span>
                        {card.race && (
                             <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm font-medium border border-gray-700">
                                {card.race}
                             </span>
                        )}
                        {card.attribute && (
                             <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm font-medium border border-gray-700 font-mono">
                                {card.attribute}
                             </span>
                        )}
                    </div>
                </div>
                <button onClick={onClose} className="p-2 bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                </button>
            </div>

            {/* Inventory / Variants Section */}
            <div className="bg-[#2a2a2a] p-4 rounded-xl border border-gray-700 mb-6 flex-shrink-0">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold uppercase text-gray-400">Deine Exemplare</span>
                    <span className="text-xs text-gray-500">Gesamt: {localVariants.reduce((s, v) => s + (v.quantity || 0), 0)}</span>
                </div>

                <div className="space-y-3 mb-4">
                    {localVariants.length === 0 && <p className="text-gray-500 text-sm italic">No variants owned.</p>}
                    {localVariants.map((variant, idx) => (
                        <div key={idx} className="flex items-start justify-between bg-black/40 p-2 rounded-lg border border-gray-800">
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm text-yellow-500 font-bold">{variant.set_code}</span>
                                    <span className="text-xs text-gray-400 border border-gray-700 px-1 rounded">{variant.rarity}</span>
                                </div>
                                <span className="text-xs text-space-violet">{fmtEUR(variant.price || 0)}</span>
                            </div>

                            <div className="flex-1 ml-4">
                                {groupCopies(copiesByKey[vKey(variant)] || []).map(g => (
                                    <div key={`${g.edition}|${g.condition}`} className="flex items-center gap-2 py-1">
                                        <div className="flex items-center bg-[#1E1E1E] rounded border border-gray-600">
                                            <button onClick={() => changeGroup(variant, g, -1)} className="p-1 hover:bg-gray-700 rounded-l text-gray-400 hover:text-white"><Minus className="w-3 h-3" /></button>
                                            <span className="w-8 text-center font-mono text-sm font-bold">{g.count}×</span>
                                            <button onClick={() => changeGroup(variant, g, 1)} className="p-1 hover:bg-gray-700 rounded-r text-gray-400 hover:text-white"><Plus className="w-3 h-3" /></button>
                                        </div>
                                        <select value={g.condition} onChange={e => moveGroup(variant, g, { edition: g.edition, condition: e.target.value })}
                                            className="bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white font-mono">
                                            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <select value={g.edition} onChange={e => moveGroup(variant, g, { edition: e.target.value, condition: g.condition })}
                                            className="bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white">
                                            {EDITIONS.map(ed => <option key={ed} value={ed}>{EDITION_LABELS[ed]}</option>)}
                                        </select>
                                        <span className="ml-auto font-mono text-xs text-gold">{fmtEUR(valueOf(variant.price, [g]))}</span>
                                    </div>
                                ))}
                                <button onClick={() => addStandardCopy(variant)} className="mt-1 text-xs text-gray-400 hover:text-space-violet flex items-center gap-1">
                                    <Plus className="w-3 h-3" /> Exemplar hinzufügen
                                </button>
                            </div>
                            <div className="flex flex-col items-end gap-2 ml-3">
                                <input type="number" step="0.01" min="0" defaultValue={variant.price ?? 0}
                                  onBlur={async (e) => {
                                    const price = parseFloat(e.target.value);
                                    if (isNaN(price)) return;
                                    await window.api.setCardPrice({ id: card.id, set_code: variant.set_code, language: variant.language || 'DE', rarity: variant.rarity, price });
                                  }}
                                  className="w-16 bg-black/40 border border-gray-700 rounded px-1 py-0.5 text-xs text-white"
                                  title="Preis manuell setzen (überschreibt Auto-Preis)" />
                                {variant.cm_updated_at && !variant.cm_url && (
                                  <span className="text-[9px] text-yellow-500/80" title="Auf Cardmarket nicht eindeutig gefunden">kein CM-Treffer</span>
                                )}
                                <button onClick={() => { if (confirm(`${variant.set_code} (${variant.rarity}) mit allen Exemplaren löschen?`)) handleDeleteVariant(variant); }}
                                    className="p-1.5 bg-crit/10 hover:bg-crit/20 text-crit rounded transition-colors" title="Printing löschen">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Add New Variant */}
                <div className="pt-3 border-t border-gray-700">
                    <label className="text-xs text-gray-500 uppercase font-bold mb-2 block">Add Another Printing</label>
                    <div className="flex gap-2">
                         <div className="flex-1">
                            <CustomSelect
                                value={selectedNewSet}
                                onChange={setSelectedNewSet}
                                placeholder="Select Set..."
                                options={(() => {
                                    // Deduplicate sets based on set_code + rarity
                                    const unique = new Map();
                                    availableSets.forEach(s => {
                                        const key = `${s.set_code}|${s.set_rarity}`;
                                        if (!unique.has(key)) unique.set(key, s);
                                    });

                                    const list = Array.from(unique.values())
                                        .filter(s => !localVariants.some(v => v.set_code === s.set_code && v.rarity === s.set_rarity));
                                    return list.map((set, i) => ({
                                        value: `${set.set_code}|${set.set_rarity}`,
                                        // Separate the language groups (DE | EN | JP) with a thin divider + spacing.
                                        divider: i > 0 && list[i - 1].language !== set.language,
                                        label: (
                                            <span className="inline-flex items-center gap-1.5">
                                                <Flag lang={set.language} />
                                                {`${set.set_code} - ${set.set_rarity}${set.set_price ? ` ($${set.set_price})` : ''}`}
                                            </span>
                                        )
                                    }));
                                })()}
                            />
                        </div>
                        <button
                            onClick={handleAddVariant}
                            disabled={!selectedNewSet || isAdding}
                            className="bg-space-violet hover:bg-violet-600 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isAdding ? 'Adding...' : 'Add'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
                {/* Level / Rank / Link Rating */}
                {card.level != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">{levelLabel}</span>
                        <span className="text-xl font-bold text-yellow-500">{isLink ? `LINK-${card.level}` : `★ ${card.level}`}</span>
                    </div>
                )}

                {/* ATK */}
                {card.atk != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">ATK</span>
                        <span className="text-xl font-bold text-red-400">{card.atk}</span>
                    </div>
                )}

                 {/* DEF (Hide if Link) */}
                 {!isLink && card.def != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">DEF</span>
                        <span className="text-xl font-bold text-blue-400">{card.def}</span>
                    </div>
                )}

                 {/* Passcode */}
                <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                    <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Passcode</span>
                    <span className="text-xl font-mono text-gray-300">{card.id}</span>
                </div>
            </div>

            <div className="prose prose-invert max-w-none flex-shrink-0">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Description</h3>
                <p className="text-gray-400 leading-relaxed whitespace-pre-wrap font-serif text-lg bg-black/20 p-4 rounded-lg border border-gray-800 max-h-[200px] overflow-y-auto custom-scrollbar">
                    {card.desc}
                </p>
            </div>
        </div>
      </div>
    </div>
  );
}
