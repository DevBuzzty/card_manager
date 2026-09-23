// Spec I §3.3 -- aus den fruehereren Chips "Unvollstaendig" und "Foils" werden gespeicherte Filter.
import { getRarityInfo } from './rarity.js';

export const PRESETS = [
  { id: 'unvollstaendig', label: 'Unvollständige Daten' },
  { id: 'foils', label: 'Nur Foils' },
];

export function matchesPreset(card, id) {
  if (!card) return false;
  if (id === 'unvollstaendig') {
    const ohneSet = !card.set_code || card.set_code === 'Unknown';
    const ohneRarity = !card.rarity;
    const ohnePreis = !Number(card.price);
    return ohneSet || ohneRarity || ohnePreis;
  }
  // Foil ist, was rarity.js#getRarityInfo als Foil fuehrt (super/ultra/secret-Stufe) -- keine eigene
  // Liste, damit es nur EINE Einordnung im Projekt gibt (Fixrunde 1: die alte Liste war unvollstaendig).
  if (id === 'foils') return !!getRarityInfo(card.rarity).foil;
  return false;
}

// Fixrunde 1: eine Kachel (mehrere Drucke desselben Passcodes) trifft eine Voreinstellung, wenn
// IRGENDEIN Druck sie trifft -- wie die anderen Filter derselben Liste (c.rarities, c.sets, ...)
// und wie frueher hasFoilVariant/hasUnknownVariant. Leere oder fehlende Liste trifft nichts.
export function matchesPresetGroup(variants, id) {
  return Array.isArray(variants) && variants.length > 0 && variants.some(v => matchesPreset(v, id));
}
