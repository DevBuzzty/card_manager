import { BAN_LABELS } from '../utils/deckLegality';

// Drei Stufen fallend restriktiv (0/1/2 Kopien); nur bad/warn stehen als Rollen zur Verfuegung
// (Spec I §6.2). "forbidden" und "limited" teilen sich bad -- volle Deckkraft, damit text-accent-fg
// seinen geprueften Kontrast behaelt (ein getoentes bg-bad/NN waere zu hell fuer accent-fg); die
// Zahl im Label ("Verboten"/"1"/"2") unterscheidet die Stufen ohnehin genauer als eine Farbe es koennte.
const BAN_CLASSES = {
  forbidden: 'bg-bad text-accent-fg',
  limited: 'bg-bad text-accent-fg',
  semi: 'bg-warn text-accent-fg',
};

// Spec E3 §7 — Banlist-Icon an der Kartenzeile: bad "Verboten", bad "1", warn "2"; uneingeschraenkt kein Icon.
export default function DeckBanIcon({ ban }) {
  if (!ban) return null;
  return (
    <span className={`px-1.5 rounded text-klein font-bold leading-4 flex-shrink-0 ${BAN_CLASSES[ban]}`}>{BAN_LABELS[ban]}</span>
  );
}
