// Single source of truth for how a card's type and rarity are rendered.
// Returns hex colour values (not Tailwind class names) so callers apply them via
// inline styles — safe from Tailwind's class purge.

export const FRAME_COLORS = {
  monster: '#E8944A',
  spell: '#1DA891',
  trap: '#C4568A',
  normal: '#CBB07A',
};

// Map a YGOPRODeck card `type` string to a frame category.
export function getFrameType(cardType) {
  const t = (cardType || '').toLowerCase();
  if (t.includes('spell')) return 'spell';
  if (t.includes('trap')) return 'trap';
  if (t.includes('normal') && t.includes('monster')) return 'normal';
  return 'monster'; // effect/ritual/fusion/synchro/xyz/link/token all use the monster frame
}

export function getFrameColor(cardType) {
  return FRAME_COLORS[getFrameType(cardType)];
}

const RARITY_TIERS = {
  common: { label: 'Common', color: '#8a8594', foil: false },
  rare: { label: 'Rare', color: '#6db4e8', foil: false },
  super: { label: 'Super', color: '#e8c76d', foil: 'holo' },
  ultra: { label: 'Ultra', color: '#f5c542', foil: 'holo' },
  secret: { label: 'Secret', color: '#ff5db1', foil: 'secret' },
};

// Normalise the many printed rarity strings to one of five tiers.
export function getRarityInfo(rarity) {
  const r = (rarity || '').toLowerCase();
  let key = 'common';
  if (!r || r.includes('common') || r.includes('short print') || r === 'unknown') key = 'common';
  else if (r.includes('secret') || r.includes('ultimate') || r.includes('ghost') || r.includes('starlight') || r.includes('prismatic') || r.includes('collector')) key = 'secret';
  else if (r.includes('ultra')) key = 'ultra';
  else if (r.includes('super')) key = 'super';
  else if (r.includes('rare')) key = 'rare';
  return { key, ...RARITY_TIERS[key] };
}
