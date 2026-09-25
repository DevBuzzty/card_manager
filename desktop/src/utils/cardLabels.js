// Deutsche Anzeige der englischen Kartendaten (YGOPRODeck: "Spell Card", "DARK", "Dragon") in Statistik und Portfolio,
// Feinschliff 26.09.2026. ZWILLING: android .../ml/CardLabels.kt, gemeinsame Fixture docs/fixtures/valuation/card-labels.json.
// Unbekannte Werte bleiben, wie sie sind. Namen wie auf deutschen Konami-Karten.

export const ATTRIBUTE_LABELS = {
  DARK: 'Finsternis', LIGHT: 'Licht', EARTH: 'Erde', WATER: 'Wasser', FIRE: 'Feuer', WIND: 'Wind', DIVINE: 'Göttlich',
};

export const RACE_LABELS = {
  Aqua: 'Aqua', Beast: 'Ungeheuer', 'Beast-Warrior': 'Ungeheuer-Krieger', 'Creator-God': 'Schöpfergott', Cyberse: 'Cyberse',
  Dinosaur: 'Dinosaurier', 'Divine-Beast': 'Göttliches Ungeheuer', Dragon: 'Drache', Fairy: 'Fee', Fiend: 'Unterweltler',
  Fish: 'Fisch', Illusion: 'Illusion', Insect: 'Insekt', Machine: 'Maschine', Plant: 'Pflanze', Psychic: 'Psi',
  Pyro: 'Pyro', Reptile: 'Reptil', Rock: 'Fels', 'Sea Serpent': 'Seeschlange', Spellcaster: 'Hexer', Thunder: 'Donner',
  Warrior: 'Krieger', 'Winged Beast': 'Geflügeltes Ungeheuer', Wyrm: 'Wyrm', Zombie: 'Zombie',
  Normal: 'Normal', Continuous: 'Permanent', 'Quick-Play': 'Schnell', Field: 'Spielfeld', Equip: 'Ausrüstung',
  Ritual: 'Ritual', Counter: 'Konter',
};

// Kartenart als Gruppe (gleiche Reihenfolge der Prüfung wie Dashboard.kt#typeGroup: Zauber/Falle vor Monster).
export function typeGroup(type) {
  const t = String(type || '');
  if (/spell/i.test(t)) return 'Zauber';
  if (/trap/i.test(t)) return 'Falle';
  if (/monster/i.test(t)) return 'Monster';
  return 'Sonstige';
}

export const attributeLabel = (a) => ATTRIBUTE_LABELS[a] ?? a;
export const raceLabel = (r) => RACE_LABELS[r] ?? r;
