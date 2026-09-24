import { LOADING } from '../utils/deckCoverage';
import { FORMAT_LABELS, badgeKind, badgeText, normalizeFormat } from '../utils/deckLegality';

// Schluessel sind die Badge-Arten aus deckLegality.js#badgeKind (Zwilling mit DeckLegality.kt) --
// nur die Farbrollen rechts sind aus Spec I §6.2 aktualisiert.
const KIND_CLASSES = {
  legal: 'bg-good/15 text-text border-good/40',
  warn: 'bg-warn/15 text-text border-warn/40',
  crit: 'bg-bad/15 text-text border-bad/40',
  free: 'bg-surface-2/40 text-text border-line',
};

// Spec E3 §7 — Format-Chip und Legalitaets-Badge (gruen "Legal", gelb "Legal · n Warnungen", rot "n Verstöße",
// grau "Frei"). result null = Katalog-Index noch nicht geladen: "…", nie ein vorlaeufiges "Legal".
export default function DeckLegalityBadge({ result, format, showFormat = false }) {
  const f = normalizeFormat(format);
  return (
    <span className="inline-flex items-center gap-1.5">
      {showFormat && (
        <span className="px-1.5 py-0.5 rounded border border-line text-klein font-mono text-muted">{FORMAT_LABELS[f]}</span>
      )}
      {result ? (
        <span className={`px-1.5 py-0.5 rounded border text-klein font-medium ${KIND_CLASSES[badgeKind(result, f)]}`}>{badgeText(result, f)}</span>
      ) : (
        <span className="text-klein text-muted">{LOADING}</span>
      )}
    </span>
  );
}
