// The app is German. This is the shared vocabulary — strings that appear in more than one
// component — so a rename happens in one place. Single-use strings stay inline where they belong.
// Yu-Gi-Oh terms (Rarity, Set-Code, Passcode, Secret Rare …) stay English on purpose.
export const T = {
  start: 'Start',
  scannen: 'Scannen',
  sammlung: 'Sammlung',
  karten: 'Karten',
  wunschliste: 'Wunschliste',
  sets: 'Sets',
  decks: 'Decks',
  deals: 'Deals',
  insights: 'Insights',
  einstellungen: 'Einstellungen',
  uebernehmen: 'Übernehmen',
  pruefen: 'Prüfen',
  abbrechen: 'Abbrechen',
  zurueck: 'Zurück',
  suchen: 'Suchen',
  keineTreffer: 'Keine Treffer',
  exemplar: 'Exemplar',
  exemplare: 'Exemplare',
};

// Sidebar order. `key` doubles as the lucide icon lookup in Sidebar.jsx.
export const NAV = [
  { key: 'start', to: '/start', label: T.start },
  { key: 'scannen', to: '/scannen', label: T.scannen },
  { key: 'sammlung', to: '/sammlung/karten', label: T.sammlung },
  { key: 'deals', to: '/deals', label: T.deals },
  { key: 'insights', to: '/insights', label: T.insights },
];
