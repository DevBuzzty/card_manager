// Spec I §3.3 -- aus den fruehereren Chips "Unvollstaendig" und "Foils" werden gespeicherte Filter.
export const PRESETS = [
  { id: 'unvollstaendig', label: 'Unvollständige Daten' },
  { id: 'foils', label: 'Nur Foils' },
];

const FOIL_RARITIES = ['Super Rare', 'Ultra Rare', 'Secret Rare', 'Ultimate Rare', 'Ghost Rare', 'Starlight Rare', 'Collector’s Rare'];

export function matchesPreset(card, id) {
  if (!card) return false;
  if (id === 'unvollstaendig') {
    const ohneSet = !card.set_code || card.set_code === 'Unknown';
    const ohneRarity = !card.rarity;
    const ohnePreis = !Number(card.price);
    return ohneSet || ohneRarity || ohnePreis;
  }
  if (id === 'foils') return FOIL_RARITIES.includes(String(card.rarity || ''));
  return false;
}
