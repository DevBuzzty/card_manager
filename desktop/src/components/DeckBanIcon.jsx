import { BAN_LABELS } from '../utils/deckLegality';

const BAN_CLASSES = {
  forbidden: 'bg-bad text-white',
  limited: 'bg-orange-500 text-white',
  semi: 'bg-warn text-black',
};

// Spec E3 §7 — Banlist-Icon an der Kartenzeile: rot "Verboten", orange "1", gelb "2"; uneingeschraenkt kein Icon.
export default function DeckBanIcon({ ban }) {
  if (!ban) return null;
  return (
    <span className={`px-1.5 rounded text-[10px] font-bold leading-4 flex-shrink-0 ${BAN_CLASSES[ban]}`}>{BAN_LABELS[ban]}</span>
  );
}
