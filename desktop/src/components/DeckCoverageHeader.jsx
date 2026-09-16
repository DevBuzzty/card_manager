import { useNavigate } from 'react-router-dom';
import { Heart, PackageOpen } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { ROUTES } from '../utils/routes';
import { LOADING, deckBoxChoices, deckBoxId, headerText } from '../utils/deckCoverage';

// Spec E1 §8 — Abgleich-Kopf im Deck-Editor: Deckbox-Auswahl, Kennzahlen, "Fehlende auf die Wunschliste", "Box befüllen".
// coverage/containers null = noch nicht geladen: dann "…", nie 0/40.
export default function DeckCoverageHeader({ deck, decks, coverage, containers, error, boxError, onChangeBox, onOpenWishlist, onOpenFillBox }) {
  const navigate = useNavigate();
  const hasDeckboxes = !!containers && containers.some((c) => !c.deleted && c.kind === 'deckbox');
  const options = containers
    ? [{ value: '', label: 'Keine Box' }, ...deckBoxChoices(deck.id, decks, containers).map((c) => ({ value: c.container_id, label: c.name }))]
    : [];

  return (
    <div className="mb-4 p-3 bg-black/30 rounded-xl border border-gray-800 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold uppercase text-gray-500">Deckbox</span>
        {!containers ? (
          <span className="text-sm text-gray-400">{LOADING}</span>
        ) : hasDeckboxes ? (
          <CustomSelect className="w-56" value={deckBoxId(deck, containers) || ''} onChange={onChangeBox} options={options} />
        ) : (
          <span className="text-sm text-gray-400">
            Noch keine Deckbox ·{' '}
            <button type="button" onClick={() => navigate(ROUTES.binder)} className="text-space-violet hover:underline">Zu den Behältern</button>
          </span>
        )}
        <span className="font-mono text-sm text-gray-300">{coverage ? headerText(coverage) : LOADING}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button" onClick={onOpenWishlist} disabled={!coverage || coverage.totals.missing === 0}
          className="flex items-center px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Heart className="w-4 h-4 mr-2" /> Fehlende auf die Wunschliste
        </button>
        <button
          type="button" onClick={onOpenFillBox} disabled={!coverage || !coverage.boxId}
          className="flex items-center px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PackageOpen className="w-4 h-4 mr-2" /> Box befüllen
        </button>
      </div>
      {boxError && <p className="text-sm text-red-400">{boxError}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
