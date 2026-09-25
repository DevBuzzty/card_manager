import { getFrameColor, getRarityInfo } from '../utils/rarity.js';
import { fmtEUR } from '../utils/format';

// saleNote: Spec H1 §5.3 Zusatz "(2 zum Verkauf)" der Sammlungszeile, sonst null.
// selectMode/selected: Mehrfachauswahl der Kartenliste (Häkchen oben links, Rahmen in Akzentfarbe).
export default function CardTile({ card, onClick, saleNote = null, selectMode = false, selected = false }) {
  const frame = getFrameColor(card.type);
  const qty = card.quantity || 1;
  const total = card.totalValue != null ? card.totalValue
              : (card.value != null ? card.value : (card.price || 0) * qty);

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
      className={`group relative rounded-xl overflow-hidden bg-surface-2 border cursor-pointer transition-transform hover:-translate-y-0.5 ${selected ? 'border-accent outline outline-2 outline-accent' : 'border-line'}`}
      style={{ boxShadow: `inset 0 0 0 1.5px ${frame}55` }}
      aria-pressed={selectMode ? selected : undefined}
    >
      {selectMode && (
        <span className={`absolute top-2 left-2 z-20 w-6 h-6 rounded-full border-2 grid place-items-center text-sm font-bold ${selected ? 'bg-accent border-accent text-accent-fg' : 'bg-bg/80 border-line text-transparent'}`}
          aria-hidden="true">✓</span>
      )}
      {/* Art */}
      <div className="relative h-36 bg-bg overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 z-10" style={{ backgroundColor: frame }} />
        {card.image_url ? (
          <img src={card.image_url} alt={card.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted text-2xl">?</div>
        )}
        {anyFoil && <span className={`foil-sheen${rarityInfos.some(r => r.foil === 'secret') ? ' secret' : ''}`} />}

        {qty > 1 && (
          <span className="absolute top-2 right-2 z-10 font-mono text-klein font-semibold px-1.5 py-0.5 rounded bg-bg/80 text-text border border-line">
            ×{qty}
          </span>
        )}
        {card.nonstandard > 0 && (
          <span className="absolute top-2 left-2 z-10 w-2 h-2 rounded-full bg-warn" title={`${card.nonstandard} Exemplar(e) mit abweichendem Zustand/Edition`} />
        )}

        {/* All owned rarities -- Spec I §6.2 Regel 3: Seltenheit ueber Schriftschnitt, nicht Farbe. */}
        <div className="absolute bottom-2 left-2 right-2 z-10 flex flex-wrap gap-1">
          {rarityInfos.slice(0, 3).map((r, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 font-display text-klein uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-bg/75 text-muted ${r.foil ? 'font-bold' : 'font-semibold'}`}
            >
              <span className="w-[6px] h-[6px] rounded-full bg-muted" />
              {/* I2: ohne bekannte Seltenheit nicht als "Common" ausweisen */}
              {rarities[i] && String(rarities[i]).toLowerCase() !== 'unknown' ? r.label : 'Unbekannt'}
            </span>
          ))}
          {rarityInfos.length > 3 && (
            <span className="font-mono text-klein text-muted bg-bg/75 px-1.5 py-0.5 rounded-full">+{rarityInfos.length - 3}</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="p-2.5">
        <h4 className="text-xs font-bold text-text leading-tight truncate">{card.name}</h4>
        {saleNote && <div className="text-klein text-warn truncate">{saleNote}</div>}
        <div className="flex justify-between items-center mt-1 mb-1.5">
          <span className="text-klein uppercase tracking-wide text-muted font-display">Gesamt</span>
          <span className="font-mono text-klein font-bold text-text">{fmtEUR(total)}</span>
        </div>
        {/* Per-set breakdown: set code · quantity · unit price */}
        <div className="space-y-0.5">
          {shown.map((v, i) => (
            <div key={i} className="flex items-center justify-between gap-1.5 text-klein">
              <span className="font-mono text-muted truncate">
                {v.set_code || '—'}
                {v.rarity && v.rarity !== 'Unknown' && <span className="text-muted"> · {v.rarity}</span>}
              </span>
              <span className="font-mono text-muted shrink-0">×{v.quantity || 1}</span>
              <span className="font-mono text-text shrink-0 w-14 text-right">{fmtEUR(v.price || 0)}</span>
            </div>
          ))}
          {moreCount > 0 && <div className="text-klein text-muted pt-0.5">+{moreCount} weitere</div>}
        </div>
      </div>
    </div>
  );
}
