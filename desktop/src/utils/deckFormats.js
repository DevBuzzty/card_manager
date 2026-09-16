// Spec E2 §3 — Decklisten-Formate YDK, YDKE und Textliste: lesen, schreiben, erkennen.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckFormats.kt. Beide laufen gegen
// docs/fixtures/decks/formats.json. Wer eine Seite aendert, aendert beide.

export const YDKE_INVALID = 'Kein gültiger YDKE-Link';
export const NOTHING_RECOGNIZED = 'Keine Deckliste erkannt';
export const YDK_HEADER = '#created by YGO Card Manager';

const MAX_UINT32 = 4294967295;
// Standard-Base64 mit Auffuellung; leerer Block erlaubt. Beide Zwillinge pruefen mit DIESEM Muster, weil atob und
// java.util.Base64 unterschiedlich nachsichtig sind.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEADING = /^(main|extra|side)(?:\s+deck)?\s*(?::|\([0-9]+\))?$/i;
// [0-9] statt \d und Unicode-\s (geschuetztes Leerzeichen aus Webseiten): der Kotlin-Zwilling nutzt dafuer (?U).
const COUNT_FIRST = /^([0-9]+)(?:\s*[xX])?\s+(\S.*)$/;
const COUNT_LAST = /^(.+?)\s+[xX]([0-9]+)$/;

// Passcode als Zahl ohne fuehrende Nullen ("04031928" -> "4031928"); 1..2^32-1, sonst null.
export function normalizePasscode(raw) {
  const t = String(raw).trim();
  if (!/^[0-9]{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_UINT32 ? String(n) : null;
}

// Gleiche Passcodes je Abschnitt summieren, Reihenfolge des ersten Auftretens.
function addCard(cards, passcode, section, count) {
  const hit = cards.find((c) => c.passcode === passcode && c.section === section);
  if (hit) hit.count += count;
  else cards.push({ passcode, count, section });
}

export function parseYdk(text) {
  const cards = [];
  const unresolved = [];
  let section = 'main';
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (lower === '#main') section = 'main';
    else if (lower === '#extra') section = 'extra';
    else if (lower === '!side') section = 'side';
    else if (t.startsWith('#')) continue;
    else {
      const passcode = normalizePasscode(t);
      if (passcode) addCard(cards, passcode, section, 1);
      else unresolved.push(t);
    }
  }
  return { format: 'ydk', cards, unresolved };
}

function decodeBlock(block) {
  if (!BASE64.test(block)) return null;
  const bin = atob(block);
  if (bin.length % 4 !== 0) return null;
  const out = [];
  for (let i = 0; i < bin.length; i += 4) {
    out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
  }
  return out;
}

export function parseYdke(text) {
  const invalid = { format: 'ydke', cards: [], unresolved: [], error: YDKE_INVALID };
  const body = String(text).trim();
  if (!body.startsWith('ydke://')) return invalid;
  let parts = body.slice('ydke://'.length).replace(/\s+/g, '').split('!');
  if (parts.length === 4 && parts[3] === '') parts = parts.slice(0, 3);
  if (parts.length !== 3) return invalid;
  const cards = [];
  const unresolved = [];
  const sections = ['main', 'extra', 'side'];
  for (let s = 0; s < 3; s++) {
    const codes = decodeBlock(parts[s]);
    if (!codes) return invalid;
    for (const n of codes) {
      if (n === 0) unresolved.push('0');
      else addCard(cards, String(n), sections[s], 1);
    }
  }
  return { format: 'ydke', cards, unresolved };
}

// Kartenzeilen "3 Name", "3x Name", "3 x Name", "Name x3", "Name"; Ueberschriften Main/Extra/Side (Deck) mit ":" oder
// "(n)". Ohne Ueberschrift davor: section "unknown". Zeilen werden NICHT zusammengefasst (Rohzeile bleibt fuer die Notizen).
export function parseTextList(text) {
  const cards = [];
  const unresolved = [];
  let section = 'unknown';
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const heading = HEADING.exec(t);
    if (heading) { section = heading[1].toLowerCase(); continue; }
    let count = 1;
    let name = t;
    const first = COUNT_FIRST.exec(t);
    const last = first ? null : COUNT_LAST.exec(t);
    if (first) { count = Number(first[1]); name = first[2]; }
    else if (last) { name = last[1]; count = Number(last[2]); }
    if (!(count >= 1 && count <= 99)) { unresolved.push(t); continue; }
    cards.push({ name: name.trim(), count, section, line: t });
  }
  return { format: 'text', cards, unresolved };
}

export function detectFormat(text) {
  const body = String(text).trim();
  if (body.startsWith('ydke://')) return 'ydke';
  const lines = body.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  if (lines.includes('#main') || lines.includes('!side')) return 'ydk';
  return 'text';
}

// Einstieg fuer Einfuegen/Teilen/YDK-Datei: erkennt (oder nimmt das vorgegebene Format), liest, und meldet
// "Keine Deckliste erkannt", wenn keine einzige Karte gelesen wurde.
export function parseDeckText(text, format = detectFormat(text)) {
  const parsed = format === 'ydke' ? parseYdke(text) : format === 'ydk' ? parseYdk(text) : parseTextList(text);
  if (parsed.error) return parsed;
  if (parsed.cards.length === 0) return { ...parsed, error: NOTHING_RECOGNIZED };
  return parsed;
}

const live = (entries) => (entries || []).filter((e) => e && e.count > 0);
const ofSection = (entries, section) => live(entries).filter((e) => e.section === section);

// entries: [{ passcode, name?, count, section }] (mehrere Zeilen je Passcode erlaubt).
export function buildYdk(entries) {
  const lines = [YDK_HEADER];
  for (const [head, section] of [['#main', 'main'], ['#extra', 'extra'], ['!side', 'side']]) {
    lines.push(head);
    for (const e of ofSection(entries, section)) for (let i = 0; i < e.count; i++) lines.push(String(e.passcode));
  }
  return `${lines.join('\n')}\n`;
}

function encodeBlock(entries) {
  let bin = '';
  for (const e of entries) {
    const n = Number(e.passcode) >>> 0;
    const four = String.fromCharCode(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    for (let i = 0; i < e.count; i++) bin += four;
  }
  return btoa(bin);
}

export function buildYdke(entries) {
  return `ydke://${['main', 'extra', 'side'].map((s) => `${encodeBlock(ofSection(entries, s))}!`).join('')}`;
}

// "Main Deck" / "3 Name" …; je Abschnitt nach Passcode summiert (Reihenfolge des ersten Auftretens), leere Abschnitte
// entfallen, Name faellt auf den Passcode zurueck. Zeilen mit "\n" verbunden, ohne Zeilenumbruch am Ende.
export function buildTextList(entries) {
  const lines = [];
  for (const [head, section] of [['Main Deck', 'main'], ['Extra Deck', 'extra'], ['Side Deck', 'side']]) {
    const summed = [];
    for (const e of ofSection(entries, section)) {
      const hit = summed.find((x) => x.passcode === String(e.passcode));
      if (hit) hit.count += e.count;
      else summed.push({ passcode: String(e.passcode), name: e.name || String(e.passcode), count: e.count });
    }
    if (summed.length === 0) continue;
    lines.push(head);
    for (const x of summed) lines.push(`${x.count} ${x.name}`);
  }
  return lines.join('\n');
}
