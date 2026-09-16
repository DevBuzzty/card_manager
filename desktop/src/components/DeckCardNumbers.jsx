import { LOADING, reservedTexts, rowText } from '../utils/deckCoverage';

// Spec E1 §8 — Kartenzeilen-Zahlen "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
// card null = Abgleich noch nicht geladen: "…".
export default function DeckCardNumbers({ card }) {
  if (!card) return <span className="text-xs font-mono text-gray-500">{LOADING}</span>;
  return (
    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
      <span className={`text-xs font-mono ${card.missing > 0 ? 'text-red-400' : 'text-gray-400'}`}>{rowText(card)}</span>
      {reservedTexts(card).map((t) => (
        <span key={t} className="text-[10px] px-1.5 rounded bg-yellow-500/15 text-yellow-400">{t}</span>
      ))}
    </div>
  );
}
