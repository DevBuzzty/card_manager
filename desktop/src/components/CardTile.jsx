import { getFrameColor, getRarityInfo } from '../utils/rarity.js';

export default function CardTile({ card, onClick }) {
  const frame = getFrameColor(card.type);
  const qty = card.quantity || 1;
  const total = card.totalValue != null ? card.totalValue : (card.price || 0) * qty;

  // Per-printing breakdown (the grouped collection view passes `variants`); fall back to a
  // single synthetic row so the tile still works if fed an ungrouped card.
  const variants = (card.variants && card.variants.length)
    ? card.variants
    : [{ set_code: card.set_code, rarity: card.rarity, price: card.price || 0, quantity: qty }];
  const breakdown = [...variants].sort((a, b) => (b.price || 0) - (a.price || 0));
  const shown = breakdown.slice(0, 3);
  const moreCount = breakdown.length - shown.length;

  // Every distinct rarity owned (not just the first printing's).
  const rarities = card.rarities ? Array.from(card.rarities) : (card.rarity ? [card.rarity] : []);
  const rarityInfos = rarities.map(getRarityInfo);
  const anyFoil = rarityInfos.some(r => r.foil);

  return (
    <div
      onClick={onClick}
      className="group relative rounded-xl overflow-hidden bg-obsidian-600 border border-line cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: `inset 0 0 0 1.5px ${frame}55` }}
    >
      {/* Art */}
      <div className="relative h-36 bg-obsidian-800 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 z-10" style={{ backgroundColor: frame }} />
        {card.image_url ? (
          <img src={card.image_url} alt={card.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-ink-faint text-2xl">?</div>
        )}
        {anyFoil && <span className={`foil-sheen${rarityInfos.some(r => r.foil === 'secret') ? ' secret' : ''}`} />}

        {qty > 1 && (
          <span className="absolute top-2 right-2 z-10 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-obsidian/80 text-good border border-good/40">
            ×{qty}
          </span>
        )}

        {/* All owned rarities */}
        <div className="absolute bottom-2 left-2 right-2 z-10 flex flex-wrap gap-1">
          {rarityInfos.slice(0, 3).map((r, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 font-display text-[8.5px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-obsidian/75"
              style={{ color: r.color }}
            >
              <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: r.color, boxShadow: r.foil ? `0 0 6px ${r.color}` : 'none' }} />
              {r.label}
            </span>
          ))}
          {rarityInfos.length > 3 && (
            <span className="font-mono text-[8.5px] text-ink-faint bg-obsidian/75 px-1.5 py-0.5 rounded-full">+{rarityInfos.length - 3}</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="p-2.5">
        <h4 className="text-xs font-bold text-ink leading-tight truncate">{card.name}</h4>
        <div className="flex justify-between items-center mt-1 mb-1.5">
          <span className="text-[9px] uppercase tracking-wide text-ink-faint font-display">Gesamt</span>
          <span className="font-mono text-[12px] font-bold text-gold">€{total.toFixed(2)}</span>
        </div>
        {/* Per-set breakdown: set code · quantity · unit price */}
        <div className="space-y-0.5">
          {shown.map((v, i) => (
            <div key={i} className="flex items-center justify-between gap-1.5 text-[9.5px]">
              <span className="font-mono text-ink-faint truncate">{v.set_code || '—'}</span>
              <span className="font-mono text-ink-muted shrink-0">×{v.quantity || 1}</span>
              <span className="font-mono text-gold/80 shrink-0 w-12 text-right">€{(v.price || 0).toFixed(2)}</span>
            </div>
          ))}
          {moreCount > 0 && <div className="text-[9px] text-ink-faint pt-0.5">+{moreCount} weitere</div>}
        </div>
      </div>
    </div>
  );
}
