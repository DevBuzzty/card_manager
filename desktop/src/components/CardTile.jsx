import { getFrameColor, getRarityInfo } from '../utils/rarity.js';

export default function CardTile({ card, onClick }) {
  const frame = getFrameColor(card.type);
  const rarity = getRarityInfo(card.rarity);
  const qty = card.quantity || 1;
  const price = card.price || 0;

  return (
    <div
      onClick={onClick}
      className="group relative rounded-xl overflow-hidden bg-obsidian-600 border border-line cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: `inset 0 0 0 1.5px ${frame}55` }}
    >
      {/* Art */}
      <div className="relative aspect-square bg-obsidian-800 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 z-10" style={{ backgroundColor: frame }} />
        {card.image_url ? (
          <img src={card.image_url} alt={card.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-ink-faint text-2xl">?</div>
        )}
        {rarity.foil && <span className={`foil-sheen${rarity.foil === 'secret' ? ' secret' : ''}`} />}

        {qty > 1 && (
          <span className="absolute top-2 right-2 z-10 font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-obsidian/80 text-good border border-good/40">
            ×{qty}
          </span>
        )}
        <span
          className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1.5 font-display text-[9px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-obsidian/70"
          style={{ color: rarity.color }}
        >
          <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: rarity.color, boxShadow: rarity.foil ? `0 0 6px ${rarity.color}` : 'none' }} />
          {rarity.label}
        </span>
      </div>

      {/* Meta */}
      <div className="p-2.5">
        <h4 className="text-xs font-bold text-ink leading-tight truncate">{card.name}</h4>
        <div className="flex justify-between items-center mt-1.5">
          <span className="font-mono text-[9.5px] text-ink-faint">{card.set_code}</span>
          <span className="font-mono text-[11px] font-semibold text-gold">${price.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
