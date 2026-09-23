import { LOADING } from '../utils/deckCoverage';
import { FORMAT_LABELS, badgeKind, badgeText, normalizeFormat } from '../utils/deckLegality';

// Schluessel sind die Badge-Arten aus deckLegality.js#badgeKind (Zwilling mit DeckLegality.kt) --
// nur die Farbrollen rechts sind aus Spec I §6.2 aktualisiert.
const KIND_CLASSES = {
  legal: 'bg-good/15 text-good border-good/40',
  warn: 'bg-warn/15 text-warn border-warn/40',
  crit: 'bg-bad/15 text-bad border-bad/40',
  free: 'bg-gray-700/40 text-gray-300 border-gray-600',
};

// Spec E3 §7 — Format-Chip und Legalitaets-Badge (gruen "Legal", gelb "Legal · n Warnungen", rot "n Verstöße",
// grau "Frei"). result null = Katalog-Index noch nicht geladen: "…", nie ein vorlaeufiges "Legal".
export default function DeckLegalityBadge({ result, format, showFormat = false }) {
  const f = normalizeFormat(format);
  return (
    <span className="inline-flex items-center gap-1.5">
      {showFormat && (
        <span className="px-1.5 py-0.5 rounded border border-gray-700 text-[10px] font-mono text-gray-400">{FORMAT_LABELS[f]}</span>
      )}
      {result ? (
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${KIND_CLASSES[badgeKind(result, f)]}`}>{badgeText(result, f)}</span>
      ) : (
        <span className="text-[10px] text-gray-500">{LOADING}</span>
      )}
    </span>
  );
}
