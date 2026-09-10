import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  columns, isPlaced, pageCount, slots, loose, filterCandidates, candidateGroups, candidatesEmpty,
} from './binderGrid.js';

// Spec B2 §7.2: die reinen Rechnungen der Binder-Ansicht. Die Ansicht selbst laesst sich hier nicht
// pruefen -- diese Rechnungen schon, und sie sind es, an denen die Spec haengt (Seitenzahl aus der
// hoechsten BELEGTEN Seite, mehrfach belegte Faecher, Faecher jenseits der Ordnergroesse).
//
// Fall fuer Fall derselbe Aufbau wie der Kotlin-Zwilling
// android/app/src/test/java/com/example/yugiohscanner/BinderGridTest.kt. Der Abschnitt "nur
// JavaScript" am Ende prueft die im Kopfkommentar von binderGrid.js genannten Abweichungen -- sie
// haben in Kotlin kein Gegenstueck, weil `Int?`/`List<CopyRow>` sie nicht entgegennehmen koennen.

const copy = (copy_id, { page = null, slot = null, set_code = 'LOB-DE001', card_id = '12345678', tags = null, note = null } = {}) =>
  ({ copy_id, card_id, set_code, language: 'DE', rarity: 'Common', edition: 'unlimited', condition: 'NM', container_id: 'b1', page, slot, tags, note });

const ids = (l) => l.map((c) => c.copy_id);

// --- columns ---

test('vier Faecher ergeben zwei Spalten', () => assert.equal(columns(4), 2));
test('neun Faecher ergeben drei Spalten', () => assert.equal(columns(9), 3));
test('zwoelf Faecher ergeben drei Spalten', () => assert.equal(columns(12), 3));

test('unsinnige Fachzahl faellt auf den 4er-Ordner zurueck', () => {
  // slotMath.js#clampPockets zieht 0 auf 4 -- binderGrid baut die Regel nicht nach.
  assert.equal(columns(0), 2);
  assert.equal(columns(-3), 2);
});

// --- isPlaced / loose ---

test('Exemplar ohne Seite oder Fach ist nicht einsortiert', () => {
  assert.equal(isPlaced(copy('c1'), 9), false);
  assert.equal(isPlaced(copy('c2', { page: 2 }), 9), false);
  assert.equal(isPlaced(copy('c3', { slot: 5 }), 9), false);
});

test('Fach jenseits der Ordnergroesse gilt nicht als einsortiert', () => {
  // Rest einer frueheren, groesseren Seitengroesse: Fach 12 gibt es im 9er-Ordner nicht.
  assert.equal(isPlaced(copy('c1', { page: 1, slot: 12 }), 9), false);
  assert.equal(isPlaced(copy('c2', { page: 1, slot: 9 }), 9), true);
});

test('loose sammelt genau die nicht darstellbaren Exemplare', () => {
  const copies = [
    copy('drin', { page: 1, slot: 1 }),
    copy('ohneFach'),
    copy('zuHohesFach', { page: 1, slot: 12 }),
  ];
  assert.deepEqual(ids(loose(copies, 9)), ['ohneFach', 'zuHohesFach']);
});

// --- pageCount ---

test('leerer Ordner hat trotzdem eine Seite', () => {
  assert.equal(pageCount([], 9), 1);
  assert.equal(pageCount([copy('c1')], 9), 1);
});

test('Seitenzahl ist die hoechste belegte Seite, nicht ceil Anzahl durch Faecher', () => {
  // Ein einziges Exemplar auf Seite 7: ceil(1/9) waere 1 -- falsch.
  assert.equal(pageCount([copy('c1', { page: 7, slot: 3 })], 9), 7);
});

test('zehn Exemplare auf Seite eins ergeben trotzdem eine Seite', () => {
  // ceil(10/9) waere 2; belegt ist aber nur Seite 1 (zwei Exemplare teilen sich ein Fach).
  const copies = Array.from({ length: 10 }, (_, i) => copy(`c${i + 1}`, { page: 1, slot: i + 1 > 9 ? 9 : i + 1 }));
  assert.equal(pageCount(copies, 9), 1);
});

test('eine Seite, auf der nur zu hohe Faecher liegen, zaehlt nicht', () => {
  const copies = [copy('c1', { page: 1, slot: 1 }), copy('c2', { page: 4, slot: 12 })];
  assert.equal(pageCount(copies, 9), 1);
});

// Die Ansicht leitet die Seitenzahl aus DERSELBEN Liste und DERSELBEN Fachzahl ab, aus denen sie
// auch die Faecher baut. Diese Pruefung haelt beide Rechnungen aneinander: die letzte gezaehlte
// Seite zeigt wirklich etwas, und die Seite dahinter ist leer.
test('die letzte gezaehlte Seite ist belegt, die naechste nicht', () => {
  const copies = [
    copy('c1', { page: 1, slot: 1 }),
    copy('c2', { page: 3, slot: 5 }),
    copy('ohneFach'),
    copy('zuHohesFach', { page: 9, slot: 12 }),
  ];
  const last = pageCount(copies, 9);
  assert.equal(last, 3);
  assert.ok(slots(copies, last, 9).some((s) => s.length > 0));
  assert.ok(slots(copies, last + 1, 9).every((s) => s.length === 0));
});

// --- slots ---

test('slots liefert immer genau so viele Faecher wie die Seite gross ist', () => {
  assert.equal(slots([], 1, 4).length, 4);
  assert.equal(slots([], 1, 9).length, 9);
  assert.equal(slots([], 1, 12).length, 12);
});

test('slots ordnet jedes Exemplar seinem Fach zu, Fach eins steht an Position null', () => {
  const copies = [copy('c1', { page: 1, slot: 1 }), copy('c3', { page: 1, slot: 3 })];
  const page = slots(copies, 1, 4);
  assert.deepEqual(ids(page[0]), ['c1']);
  assert.deepEqual(ids(page[1]), []);
  assert.deepEqual(ids(page[2]), ['c3']);
  assert.deepEqual(ids(page[3]), []);
});

test('mehrere Exemplare im selben Fach bleiben zusammen und in Eingabereihenfolge', () => {
  const copies = [
    copy('erst', { page: 2, slot: 5 }),
    copy('dann', { page: 2, slot: 5 }),
    copy('andereSeite', { page: 3, slot: 5 }),
  ];
  assert.deepEqual(ids(slots(copies, 2, 9)[4]), ['erst', 'dann']);
});

test('slots zeigt nur die verlangte Seite', () => {
  const copies = [copy('s1', { page: 1, slot: 1 }), copy('s2', { page: 2, slot: 1 })];
  assert.deepEqual(ids(slots(copies, 2, 9)[0]), ['s2']);
});

test('slots laesst ein Fach jenseits der Ordnergroesse weg', () => {
  assert.ok(slots([copy('zuHoch', { page: 1, slot: 12 })], 1, 9).every((s) => s.length === 0));
});

// --- filterCandidates ---

const named = { a: 'Blauäugiger Weißer Drache', b: 'Dunkler Magier' };
const nameOf = (c) => named[c.copy_id];

test('leere Suche liefert alles', () => {
  assert.equal(filterCandidates([copy('a'), copy('b')], '   ', nameOf).length, 2);
});

test('Suche trifft Name, Set-Code, Passcode, Tag und Notiz', () => {
  const copies = [
    copy('a'),
    copy('b', { set_code: 'SDK-DE042' }),
    copy('c', { card_id: '89631139' }),
    copy('d', { tags: '["Handelsstapel"]' }),
    copy('e', { note: 'geknickte Ecke' }),
  ];
  const hit = (q) => ids(filterCandidates(copies, q, nameOf));
  assert.deepEqual(hit('weißer'), ['a']);        // Name, Gross-/Kleinschreibung egal
  assert.deepEqual(hit('SDK-DE042'), ['b']);      // Set-Code
  assert.deepEqual(hit('89631139'), ['c']);       // Passcode
  assert.deepEqual(hit('handelsstapel'), ['d']);  // Tag
  assert.deepEqual(hit('knick'), ['e']);          // Notiz
});

test('Suche ohne Treffer liefert nichts', () => {
  assert.deepEqual(filterCandidates([copy('a')], 'Exodia', nameOf), []);
});

// --- candidateGroups ---
//
// "Aus Fach nehmen" raeumt nur Seite und Fach, nicht den Behaelter. Damit das keine Sackgasse ist,
// muss das Auswahlangebot eines leeren Fachs die Exemplare DIESES Ordners ohne Fach mitanbieten --
// als eigene, voranstehende Gruppe neben den Exemplaren ohne Behaelter.

test('Auswahlangebot bietet zuerst den eigenen Ordner, dann die nicht einsortierten', () => {
  const l = loose([copy('drin', { page: 1, slot: 1 }), copy('ausgefacht')], 9);
  const groups = candidateGroups(l, [copy('frei')], '', nameOf);
  assert.deepEqual(ids(groups.inContainer), ['ausgefacht']);
  assert.deepEqual(ids(groups.unsorted), ['frei']);
  assert.equal(candidatesEmpty(groups), false);
});

test('ein aus dem Fach genommenes Exemplar bleibt einlegbar', () => {
  // Genau der Zustand nach "Aus Fach nehmen": Behaelter noch da, Seite und Fach leer. Vorher war er
  // eine Sackgasse -- weder im Raster noch im Auswahlangebot.
  const ausgefacht = copy('c1', { page: null, slot: null });
  const groups = candidateGroups(loose([ausgefacht], 9), [], '', nameOf);
  assert.deepEqual(ids(groups.inContainer), ['c1']);
});

test('die Suche wirkt auf beide Gruppen', () => {
  const l = [copy('a'), copy('b')];                     // "Blauäugiger..." und "Dunkler Magier"
  const u = [copy('x', { set_code: 'SDK-DE042' }), copy('y', { note: 'Blau geknickt' })];
  const groups = candidateGroups(l, u, 'blau', nameOf);
  assert.deepEqual(ids(groups.inContainer), ['a']);
  assert.deepEqual(ids(groups.unsorted), ['y']);
});

test('ohne Kandidaten sind beide Gruppen leer', () => {
  assert.equal(candidatesEmpty(candidateGroups([], [], '', nameOf)), true);
  assert.equal(candidatesEmpty(candidateGroups([copy('a')], [copy('b')], 'Exodia', nameOf)), true);
});

// --- nur JavaScript: die im Kopfkommentar genannten Abweichungen vom Kotlin-Zwilling ---

test('Seite und Fach als Zeichenkette zaehlen wie Zahlen', () => {
  // CopySheet schreibt Seite/Fach aus <input type="number"> -- der Wert kommt als "2"/"3" zurueck,
  // und SQLite kann eine so geschriebene Spalte als Text zurueckgeben.
  const c = copy('c1', { page: '2', slot: '3' });
  assert.equal(isPlaced(c, 9), true);
  assert.equal(pageCount([c], 9), 2);
  assert.deepEqual(ids(slots([c], 2, 9)[2]), ['c1']);
  assert.deepEqual(ids(slots([c], '2', 9)[2]), ['c1']);
});

test('fehlende Listen und Felder gelten als leer, nichts wirft', () => {
  assert.equal(pageCount(undefined, 9), 1);
  assert.equal(pageCount(null, 9), 1);
  assert.equal(slots(undefined, 1, 4).length, 4);
  assert.deepEqual(loose(undefined, 9), []);
  assert.deepEqual(filterCandidates(undefined, 'x', nameOf), []);
  assert.deepEqual(filterCandidates([copy('a')], undefined, nameOf).length, 1);
  assert.equal(isPlaced(undefined, 9), false);
  assert.equal(candidatesEmpty(undefined), true);
  // Kein nameOf uebergeben: die uebrigen Felder entscheiden weiterhin.
  assert.deepEqual(ids(filterCandidates([copy('a'), copy('b', { set_code: 'SDK-DE042' })], 'SDK')), ['b']);
});

test('eine kaputte tags-Zelle bedeutet keine Tags, keinen Wurf', () => {
  // Der Spaltentext stammt aus der Cloud und kann alles sein -- parseTags faengt das ab.
  const copies = [copy('kaputt', { tags: '{nicht json' }), copy('gut', { tags: '["Tausch"]' })];
  assert.deepEqual(ids(filterCandidates(copies, 'tausch', nameOf)), ['gut']);
});

test('sehr viele Exemplare sprengen den Aufrufstapel nicht', () => {
  // Math.max(...seiten) wuerfe hier "Maximum call stack size exceeded" -- der Grund, aus dem
  // pageCount die hoechste Seite in einer Schleife mitfuehrt (siehe slotMath.js#firstFree).
  const viele = Array.from({ length: 200000 }, (_, i) => copy(`c${i}`, { page: (i % 500) + 1, slot: (i % 9) + 1 }));
  assert.equal(pageCount(viele, 9), 500);
});
