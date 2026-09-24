// The app is German. This is the shared vocabulary — strings that appear in more than one
// component — so a rename happens in one place. Single-use strings stay inline where they belong.
// Yu-Gi-Oh terms (Rarity, Set-Code, Passcode, Secret Rare …) stay English on purpose.
import { ROUTES } from './routes.js';

export const T = {
  start: 'Start',
  scannen: 'Scannen',
  sammlung: 'Sammlung',
  karten: 'Karten',
  binder: 'Binder',
  wunschliste: 'Wunschliste',
  sets: 'Sets',
  decks: 'Decks',
  sealed: 'Sealed',
  verkaufen: 'Verkaufen',
  kandidaten: 'Kandidaten',
  zumVerkauf: 'Zum Verkauf',
  angebote: 'Angebote',
  verkaeufe: 'Verkäufe',
  darstellung: 'Darstellung',
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

// Sidebar order, in four groups (Spec I §3). `key` doubles as the lucide icon lookup in
// Sidebar.jsx. ZWILLING: docs/fixtures/design/nav.json und android NavTabellenTest.kt.
export const NAV_GROUPS = [
  { group: 'Alltag', items: [
    { key: 'start', to: ROUTES.start, label: T.start },
    { key: 'scannen', to: ROUTES.scannen, label: T.scannen },
  ] },
  { group: 'Bestand', items: [
    { key: 'sammlung', to: ROUTES.karten, label: T.sammlung },
    { key: 'decks', to: ROUTES.decks, label: T.decks },
  ] },
  { group: 'Handel', items: [
    { key: 'verkaufen', to: ROUTES.verkaufen, label: T.verkaufen },
    { key: 'deals', to: ROUTES.deals, label: T.deals },
  ] },
  { group: 'Auswertung', items: [
    { key: 'insights', to: ROUTES.insights, label: T.insights },
    { key: 'einstellungen', to: ROUTES.einstellungen, label: T.einstellungen },
  ] },
];

export const SAMMLUNG_SEGMENTS = [
  { id: 'karten', to: ROUTES.karten, label: T.karten },
  { id: 'binder', to: ROUTES.binder, label: T.binder },
  { id: 'sets', to: ROUTES.sets, label: T.sets },
  { id: 'wunschliste', to: ROUTES.wunschliste, label: T.wunschliste },
  { id: 'sealed', to: ROUTES.sealed, label: T.sealed },
];

export const VERKAUFEN_SEGMENTS = [
  { id: 'kandidaten', to: ROUTES.kandidaten, label: T.kandidaten },
  { id: 'zum-verkauf', to: ROUTES.zumVerkauf, label: T.zumVerkauf },
  { id: 'angebote', to: ROUTES.angebote, label: T.angebote },
  { id: 'verkaeufe', to: ROUTES.verkaeufe, label: T.verkaeufe },
];
