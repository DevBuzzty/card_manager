# Ledger: Set-Namen-Aliase Cardmarket ↔ YGOPRODeck (03.11.)

Spec: `docs/superpowers/specs/2026-11-03-einzelscan-preis-design.md`, §15 und Abschnitt „Nachtrag Set-Aliase“.
Twin-Fixture: `docs/fixtures/cm-resolve/set-aliases.json` (130 Aliase, sortiert nach `setName`).

## Problem

Der Abgleich YGOPRODeck-`set_name` → Cardmarket-`idExpansion` lief nur über die Namen der Cardmarket-Sealed-Produkte (`products_nonsingles_3.json`).
Viele Sets fanden dabei nichts:
- Die Namen weichen ab, z. B. „Dark Revelation Volume 1“ gegenüber „Dark Revelation 1 Booster“ oder „Legendary Collection 3: Yugi's World Mega Pack“ gegenüber „Legendary Collection 3: Mega Pack Booster“.
- Oder die Expansion hat gar kein Sealed-Produkt (Duel Terminal, Promos, Duelist League, Hobby League).

Laut §15 gab es 6 809 Katalog-Drucke ohne `cm`, davon 6 394 mit Grund `no-expansion`. `resolve-cm-product` löste nur 75 davon auf.

## Umsetzung

- **Regel**, Desktop und Deno gleich: `expansionIdsFor(setNames, expansionIndex, aliases = SET_ALIASES)` prüft jeden `set_name` in drei Stufen:
  1. Namens-Treffer, `normName`
  2. Token-Schlüssel
  3. erst danach der Alias, `normName(decodeEntities(setName))`

  Namens-Treffer haben also Vorrang. Ein `set_name`, der heute schon trifft, bleibt unverändert.
  Weil alle Aufrufer die `set_name`s eines ganzen Präfixes übergeben (`setsByPrefix` in `cardmarket-bulk.cjs` und `cm_index.ts`), reicht ein Alias je Präfix.
  Damit gilt er auch für Geschwister-Namen, etwa „Wave 2“, „participation card B–F“, „Duel Terminal 6b“ oder den MVP1-Basisnamen.
- **Daten Desktop:** `desktop/electron/cm-set-aliases.json` ist ein 1:1-Spiegel der Fixture.
  `electron-builder` packt laut `package.json` → `build.files` nur `dist/**`, `electron/**` und `package.json`, also nicht `docs/`.
  Die Inhaltsgleichheit prüft `cm-resolve-fixture.test.cjs`, zusammen mit Sortierung, eindeutigen Schlüsseln und Pflichtfeldern.
- **Daten Server:** `supabase/functions/_shared/cm-set-aliases.ts`, ein TS-Modul. Edge-Bundles enthalten nur `supabase/functions/`, und ein TS-Modul vermeidet JSON-Import-Attribute.
  Die Gleichheit mit der Fixture prüft `cm-parse_test.ts`.
- **Wirkt automatisch in:**
  - Desktop: Bulk-Preis-Refresh (`resolveMissing`, `deriveProduct`, Scraper-Deriver) und Katalogbau (`makeCmLookup` → `attachCm`)
  - Server: `cm-index` (`xAus` → `x[prefix]`) und damit `resolve-cm-product`
- **`idFromVersionRow` bleibt unverändert.** Sie bekommt den Expansion-Namen von der Cardmarket-Seite, nicht den YGOPRODeck-`set_name`. Ein YGOPRODeck-Alias passt dort nicht.
- **`parse.json`** hat sechs neue Fälle, die beide Seiten bestehen (Node-Twin und Deno Weg 1 und 2):
  - Alias trifft (DR1 → 1020), dazu `cmForPrinting` eindeutig
  - Alias mit mehrdeutiger Karte → Array
  - Set-Name mit `&apos;` (LCJW → 1460)
  - Namens-Treffer hat Vorrang (LCYW → 70, nicht zusätzlich 1411)
  - unbekanntes Set bleibt `no-expansion`

## Messung (gleiche Daten wie §15: Cardmarket-Dateien, cardsets und Katalog v11 vom 03.11.)

Server (`scratchpad/messung/messung.ts`, Kette §5.3 mit `buildCmIndex` aus dem Repo).
„Vorher“ ist eine Kopie von `supabase/functions` mit leerer Alias-Liste.

| | vorher | nachher |
|---|---|---|
| Präfixe in `x` | 417 | **547** (+130; die 417 alten sind identisch, 0 geändert, 0 entfallen) |
| ohne `cm`, unverifiziert (6 159): eindeutig | 75 | **4 934** (80,1 %); dazu `no-model` 667, `no-expansion` 323, `no-candidate` 235 |
| ohne `cm`, verifiziert DE (650): eindeutig | 0 | **485** (74,6 %); dazu `no-model` 121, `no-expansion` 41, `no-candidate` 3 |
| ohne `cm` gesamt eindeutig (davon mit Trend) | 75 (75) | **5 419 (5 418)** |
| `cm`-Arrays (12 138 + 2 447) | unverändert | unverändert (gleiche Gründe-Verteilung) |

Desktop-Katalogbau offline (`cmForPrinting` wie `makeCmLookup`/`attachCm`, ohne DB, also ohne `learned` und `realId`; 54 035 Drucke ohne KR):

| Katalog v11 ohne `cm` (6 809) | nachher |
|---|---|
| eindeutige Zahl | **5 419** |
| Array (Spanne) | 788 |
| weiter ohne | 602 |

- Übergänge offline, alt → neu:
  - unverifiziert: ohne → Zahl 4 865, ohne → Array 625, ohne → ohne 597
  - verifiziert: ohne → Zahl 489, ohne → Array 121, ohne → ohne 75
  - Basis dieser Übergänge ist der offline neu gerechnete Vorher-Zustand (`cmForPrinting` mit leerer Alias-Liste, ohne `learned`/`realId`). Dort sind 6 087 unverifizierte und 685 verifizierte Drucke ohne `cm`.
    Das Katalogfeld `cm` der Tabellen darüber zählt dagegen 6 159 / 650. Deshalb ergeben die Summen nicht die Tabellenwerte, und „ohne → Zahl 489“ entspricht nicht den 485 eindeutigen der Server-Tabelle. Die Endwerte (5 419 / 788 / 602) beziehen sich auf die Katalog-Basis.
- Drucke, die vorher schon `cm` hatten und sich ändern: **0**.
- Kein Alias-`set_name` trifft heute schon per Namen, und alle stehen in `cardsets.json` unter ihrem Präfix.

Die Arrays stammen vor allem aus den Varianten-Expansionen, siehe unten: DL09/DL11–DL18, WI26, YCSW, TF04/05, WB01, WC09, YDT1, TP1 und Teile von SBC1/LCGX/PP01/PP02.
Sie bleiben Spannen, bis echte IDs (`learned`) oder der Scraper sie klären.

## Ableitung und Prüfung

- **Kandidaten** stammen aus `scratchpad/aliase/aliase.cjs`. Das Skript vergleicht für jedes Präfix ohne Expansion die Kartennamen der Katalog-Drucke mit den Cardmarket-Singles je `idExpansion`.
  Es misst `recall`/`precision` und schließt OCG-, Japanisch- und Koreanisch-Kopien sowie Schwester-Sets aus.
  Ergebnis: 228 ungelöste Sets, 130 Kandidaten.
- **Prüfung:** Jeder Kandidat wurde von zwei Skeptikern unabhängig mit eigenen Skripten nachgeprüft (`scratchpad/aliase/pruef-*`). Alle 130 wurden bestätigt, keiner ist strittig oder abgelehnt.
  Geprüft wurden der Name des nonsingles, `num_of_cards`, Zweitbester, OCG-Zwilling, Teil- und Obermengen.
  Die IDs in der Fixture sind gegen die Kandidatenliste abgeglichen; das Erzeugungsskript bricht bei jeder Abweichung ab.
- **Keine Kandidaten:** 98 Sets mit zusammen 296 Drucken.
  Bei ihnen erreicht keine Expansion `precision ≥ 0,8` mit mindestens 3 Treffern, oder `recall < 0,8`, oder der Zweitbeste liegt zu nah.
  Die größten: TYP1 52, 25YC 14, MF03 11, DOR/JMPS/WC11 je 9, EVSD 8, JMP/WC4/TSC je 7.
  Sie bleiben ohne Alias. Dazu kommen 68 Drucke mit Präfix ohne cardsets-Eintrag (STAS, DB, 26DE …).

### Hinweise der Skeptiker (kein Alias-Fehler, nur Wirkung)

- **Varianten in einer Expansion**, gleicher Name und mehrere Produkte. Die Drucke bleiben mehrdeutig (Array), und `deriveProduct` braucht Vorbilder.
  - Duelist League DL09/DL11–DL18: 4 Farbvarianten
  - WI26: Judge/Regional/OTS-Stempel. Eine willkürliche Wahl gäbe den falschen Stempel-Preis, und es wird nicht geraten.
  - YCSW: Super/Ultra
  - TF04/TF05, WB01, WC09, YDT1: 2007er und 2016er Produkte
  - TP1: zwei Codes je Karte
- **JUMP → 1066** ist Cardmarkets Sammel-Bucket für Shonen-Jump-Promos (JUMP+JMP+JMPS). 7 JUMP-Karten mit JMP/JMPS-Neuauflage bleiben mehrdeutig, falsche Einzel-IDs entstehen nicht.
- **SBC1 → 5316** enthält zusätzlich 20 Skill-Karten (precision 0,905). Für den Abgleich über Kartennamen ist das harmlos.
- **Namensvarianten** im Katalog gegenüber Cardmarket, nicht aufgelöst (Kartenname, nicht Set): Fiendish Engine Ω, Spellbook Organization / Pigeonholing Books of Spell, Muko / Null and Void, Kuwagata α / alpha, Power Up! (Skill). Je Set bleiben 1–2 Drucke `no-candidate`.
- **Geschwister-`set_name`s** wie Wave 2, B–F, 6b/7b, MVP1-Basis, DTP1 Wave 2 und YCSW 2011–2023 brauchen keinen eigenen Alias, weil die Aufrufer immer die Präfix-Union übergeben.
  Einen Aufrufer, der nur den `set_name` eines Drucks übergibt, gibt es heute nicht. Gäbe es ihn, bräuchten diese Namen eigene Einträge.

## Alle Aliase

„Wirkung“ = Lauf von `aliase.cjs` auf den Katalog-Drucken ohne `cm`, jeweils eindeutig/mehrdeutig/kein Kandidat (`resolveProduct`, ohne Ableitung).

| set_name (YGOPRODeck) | Präfix | idExpansion | Cardmarket (nonsingle bzw. Beispielkarten) | Beleg | Wirkung eindeutig/mehrdeutig/kein Kandidat |
|---|---|---|---|---|---|
| 2013 Collectible Tins Wave 1 | CT10 | 1453 | Collector's Tins 2013: Blaster, Dragon Ruler of Infernos Tin | overlap 18/18 Namen (Expansion 18), recall 1, precision 1 | 19/0/0 |
| 2014 Mega-Tin Mega Pack | MP14 | 1498 | 2014 Mega-Tins Mega-Pack Booster | overlap 246/247 Namen (Expansion 247), recall 0.996, precision 0.996 | 254/0/1 |
| 2014 Mega-Tins | CT11 | 1497 | 2014 Mega-Tins: ""Bujintei Susanowo"" Tin | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 7/0/0 |
| 2015 Mega-Tins | CT12 | 1671 | 2015 Mega-Tins: ""Odd-Eyes Pendulum Dragon"" Tin | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| 2016 Mega-Tins | CT13 | 1714 | 2016 Mega-Tins: Yugi Tin | overlap 12/12 Namen (Expansion 12), recall 1, precision 1 | 19/0/0 |
| 2017 Mega-Tins | CT14 | 1808 | 2017 Mega-Tins: Yugi Tin | overlap 8/8 Namen (Expansion 10), recall 1, precision 0.8 | 11/0/0 |
| 2018 Mega-Tins | CT15 | 2314 | 2018 Mega-Tins: Jaden Tin | overlap 10/10 Namen (Expansion 10), recall 1, precision 1 | 13/0/0 |
| Advanced Demo Deck Extra Pack | DEM4 | 2069 | ohne nonsingles; z.B. Polymerization / Galaxy Serpent | overlap 10/10 Namen (Expansion 10), recall 1, precision 1 | 11/0/0 |
| Battle Pack Tournament Prize Cards | BATT | 1417 | ohne nonsingles; z.B. Blue-Eyes Ultimate Dragon / Apprentice Magician | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 26/0/0 |
| Booster Pack Collectors Tins 2002 | BPT | 1077 | Collector's Tins 2003: Jinzo | overlap 10/10 Namen (Expansion 10), recall 1, precision 1 | 8/4/0 |
| Collectible Tins 2004 | CT1 | 1089 | Collector's Tins 2004: Blade Knight | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Collectible Tins 2005 | CT2 | 1111 | Collector's Tins 2005: Vorse Raider | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 7/0/0 |
| Collectible Tins 2006 Wave 1 | CT03 | 1107 | Collector's Tins 2006: Cyber Dragon | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 10/0/0 |
| Collectible Tins 2007 Wave 1 | CT04 | 1115 | Collector's Tins 2007: Rainbow Dragon | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Collectible Tins 2010 Wave 1 | CT07 | 1221 | Collector's Tins 2010: Red Nova Dragon | overlap 25/25 Namen (Expansion 25), recall 1, precision 1 | 32/0/0 |
| Collectible Tins 2011 Wave 1 | CT08 | 1289 | Collector's Tins 2011: Wind-Up Zenmaister Tin | overlap 18/18 Namen (Expansion 18), recall 1, precision 1 | 21/0/0 |
| Collectible Tins 2012 Wave 1 | CT09 | 1399 | Collector's Tins 2012: Evolzar Dolkka Tin | overlap 23/23 Namen (Expansion 23), recall 1, precision 1 | 28/0/0 |
| Collectible Tins Exclusive 2008 | CT05 | 1222 | Exclusive Tins 2008: Goyo Guardian | overlap 7/7 Namen (Expansion 7), recall 1, precision 1 | 8/0/0 |
| Collectible Tins Exclusive 2009 | CT06 | 1223 | Exclusive Tins 2009: Crow | overlap 8/8 Namen (Expansion 8), recall 1, precision 1 | 10/0/0 |
| Cybernetic Revolution Sneak Peek Participation Card | SP1 | 1046 | ohne nonsingles; z.B. Amazoness Chain Master / Cyber Harpie Lady | overlap 4/4 Namen (Expansion 4), recall 1, precision 1 | 4/0/0 |
| Dark Revelation Volume 1 | DR1 | 1020 | Dark Revelation 1 Booster | overlap 266/267 Namen (Expansion 267), recall 0.996, precision 0.996 | 294/0/1 |
| Dark Revelation Volume 2 | DR2 | 1013 | Dark Revelation 2 Booster | overlap 224/224 Namen (Expansion 224), recall 1, precision 1 | 246/0/0 |
| Dark Revelation Volume 3 | DR3 | 1142 | Dark Revelation 3 Booster | overlap 239/240 Namen (Expansion 240), recall 0.996, precision 0.996 | 251/0/1 |
| Dark Revelation Volume 4 | DR04 | 1143 | Dark Revelation 4 Booster | overlap 245/245 Namen (Expansion 245), recall 1, precision 1 | 245/0/0 |
| Demo Deck 2015 | DEM2 | 1761 | ohne nonsingles; z.B. Giant Soldier of Stone / Summoned Skull | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 26/0/0 |
| Demo Deck 2016 | DEM3 | 1762 | ohne nonsingles; z.B. Mystical Elf / Dragon Horn Hunter | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 24/0/0 |
| Duel Terminal - Preview Wave 1 | DTP1 | 1379 | ohne nonsingles; z.B. Blue-Eyes White Dragon / Dark Magician | overlap 31/31 Namen (Expansion 31), recall 1, precision 1 | 38/0/0 |
| Duel Terminal 1 | DT01 | 1380 | ohne nonsingles; z.B. Blue-Eyes White Dragon / Dark Magician | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 102/0/0 |
| Duel Terminal 2 | DT02 | 1381 | ohne nonsingles; z.B. Turbo Synchron / Mad Archfiend | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 101/0/0 |
| Duel Terminal 3 | DT03 | 1382 | ohne nonsingles; z.B. Vorse Raider / Blackwing - Bora the Spear | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 100/0/0 |
| Duel Terminal 4 | DT04 | 1383 | ohne nonsingles; z.B. Jester Lord / Cyberdark Horn | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 101/0/0 |
| Duel Terminal 5a | DT05 | 1384 | ohne nonsingles; z.B. Summoned Skull / Cyberdark Keel | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 102/0/0 |
| Duel Terminal 6a | DT06 | 1385 | ohne nonsingles; z.B. Silent Swordsman LV7 / Arcana Force EX - The Light Ruler | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 102/0/0 |
| Duel Terminal 7a | DT07 | 1439 | ohne nonsingles; z.B. Gogogo Golem / Big Jaws | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 102/0/0 |
| Duelist League 13 participation cards | DL13 | 1378 | ohne nonsingles; z.B. Armed Ninja / Shining Angel | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/26/0 |
| Duelist League 14 participation cards | DL14 | 1396 | ohne nonsingles; z.B. Kabazauls / Command Knight | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/21/0 |
| Duelist League 15 participation cards | DL15 | 1427 | ohne nonsingles; z.B. Skilled Dark Magician / Enraged Battle Ox | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/24/0 |
| Duelist League 16 participation cards | DL16 | 1471 | ohne nonsingles; z.B. Sabersaurus / Vampire Baby | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/22/0 |
| Duelist League 17 participation cards | DL17 | 1480 | ohne nonsingles; z.B. Lord of D. / Horus the Black Flame Dragon LV8 | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/26/0 |
| Duelist League 18 participation cards | DL18 | 1503 | ohne nonsingles; z.B. Catapult Turtle / Penguin Soldier | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/26/0 |
| Duelist League 2 participation cards | DL11 | 1376 | ohne nonsingles; z.B. Dark Magician / Right Leg of the Forbidden One | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/25/0 |
| Duelist League 2010 participation cards | DL09 | 1375 | ohne nonsingles; z.B. Blue-Eyes White Dragon / Penguin Soldier | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/28/0 |
| Duelist League 3 participation cards | DL12 | 1377 | ohne nonsingles; z.B. Elemental HERO Neos / UFO Turtle | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 0/25/0 |
| Duelist League Demo 2010 | DLDI | 1387 | ohne nonsingles; z.B. Man-Eater Bug / Nimble Momonga | overlap 5/5 Namen (Expansion 5), recall 1, precision 1 | 7/0/0 |
| Duelist Pack: Special Edition | DPK | 1092 | Duelist Pack 1&2: Special Edition | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Duelist Pack: Yusei | DP08 | 1170 | Duelist Pack: Yusei Fudo Booster | overlap 30/30 Namen (Expansion 30), recall 1, precision 1 | 35/0/0 |
| Duelist Pack: Yusei 2 | DP09 | 1186 | Duelist Pack: Yusei Fudo 2 Booster | overlap 30/30 Namen (Expansion 30), recall 1, precision 1 | 34/0/0 |
| Duelist Pack: Yusei 3 | DP10 | 1254 | Duelist Pack: Yusei Fudo 3 Booster | overlap 30/30 Namen (Expansion 30), recall 1, precision 1 | 33/0/0 |
| Exclusive Pack | EP1 | 1056 | Exclusive Pack 1 Booster | overlap 9/9 Namen (Expansion 9), recall 1, precision 1 | 9/0/0 |
| Forbidden Legacy | FL1 | 1094 | Forbidden Legacy Blister | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Gold Series | GLD1 | 1141 | Gold Series 1 Booster | overlap 45/45 Namen (Expansion 45), recall 1, precision 1 | 54/0/0 |
| Gold Series 2009 | GLD2 | 1163 | Gold Series 2 Booster | overlap 50/50 Namen (Expansion 50), recall 1, precision 1 | 55/0/0 |
| Gold Series: Haunted Mine | GLD5 | 1372 | Gold Series 5: Haunted Mine Booster | overlap 55/55 Namen (Expansion 55), recall 1, precision 1 | 60/0/0 |
| Hidden Arsenal 4: Trishula's Triumph | HA04 | 1263 | Hidden Arsenal 4 Booster | overlap 60/60 Namen (Expansion 60), recall 1, precision 1 | 65/0/0 |
| Hidden Arsenal 5: Steelswarm Invasion | HA05 | 1341 | Hidden Arsenal 5 Booster | overlap 60/60 Namen (Expansion 62), recall 1, precision 0.968 | 60/0/0 |
| Hidden Arsenal 6: Omega Xyz | HA06 | 1394 | Hidden Arsenal 6 Booster | overlap 60/60 Namen (Expansion 60), recall 1, precision 1 | 60/0/0 |
| Hidden Arsenal 7: Knight of Stars | HA07 | 1436 | Hidden Arsenal 7 Booster | overlap 70/70 Namen (Expansion 70), recall 1, precision 1 | 75/0/0 |
| Hobby League 1 participation cards A | HL1 | 1030 | ohne nonsingles; z.B. A Legendary Ocean / Fusion Gate | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Hobby League 2 participation card A | HL2 | 1109 | ohne nonsingles; z.B. Cyber Jar / Fissure | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Hobby League 3 participation card A | HL03 | 1105 | ohne nonsingles; z.B. Creature Swap / Dark Balter the Terrible | overlap 7/7 Namen (Expansion 7), recall 1, precision 1 | 7/0/0 |
| Hobby League 4 participation card A | HL04 | 1072 | ohne nonsingles; z.B. Asura Priest / Exiled Force | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Hobby League 5 participation card A | HL05 | 1106 | ohne nonsingles; z.B. Crystal Beacon / Crystal Beast Ruby Carbuncle | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Hobby League 6 participation card A | HL06 | 1157 | ohne nonsingles; z.B. Nobleman of Crossout / Limiter Removal | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 10/0/0 |
| Hobby League 7 participation card A | HL07 | 1158 | ohne nonsingles; z.B. Monster Reborn / Neo-Spacian Grand Mole | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 9/0/0 |
| Legendary Collection 2: The Duel Academy Years | LC02 | 1336 | Legendary Collection 2 | overlap 13/13 Namen (Expansion 13), recall 1, precision 1 | 15/0/0 |
| Legendary Collection 2: The Duel Academy Years Mega Pack | LCGX | 1335 | Legendary Collection 2: Mega Pack Booster | overlap 261/261 Namen (Expansion 261), recall 1, precision 1 | 274/15/0 |
| Legendary Collection 3: Yugi's World Mega Pack | LCYW | 1411 | Legendary Collection 3: Mega Pack Booster | overlap 306/306 Namen (Expansion 306), recall 1, precision 1 | 401/0/0 |
| Legendary Collection 4: Joey's World Mega Pack | LCJW | 1460 | Legendary Collection 4: Mega Pack Booster | overlap 297/298 Namen (Expansion 298), recall 0.997, precision 0.997 | 344/0/1 |
| Legendary Collection 5D's | LC05 | 1507 | Legendary Collection 5D's: Promo Box | overlap 5/5 Namen (Expansion 5), recall 1, precision 1 | 5/0/0 |
| Limited Edition 1 | JUMP | 1066 | ohne nonsingles; z.B. Archfiend of Gilfer / Blast Sphere | overlap 85/85 Namen (Expansion 90), recall 1, precision 0.944 | 78/7/0 |
| Mattel Action Figure promotional cards: Series 2 | MF02 | 1108 | ohne nonsingles; z.B. Cyber End Dragon / Water Dragon | overlap 4/4 Namen (Expansion 4), recall 1, precision 1 | 4/0/0 |
| McDonald's Promotional Cards | MP1 | 1104 | McDonald's Promo Pack 1 Booster | overlap 15/15 Namen (Expansion 15), recall 1, precision 1 | 15/0/0 |
| McDonald's Promotional Cards 2 | MDP2 | 1049 | McDonald's Promo Pack 2 Booster | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 20/0/0 |
| Movie Pack | MOV | 1093 | Yu-Gi-Oh! The Movie Booster | overlap 4/4 Namen (Expansion 4), recall 1, precision 1 | 4/0/0 |
| Premium Gold: Infinite Gold | PGL3 | 1698 | Premium Gold: Infinite Gold Booster (10 cards) | overlap 100/100 Namen (Expansion 100), recall 1, precision 1 | 118/0/0 |
| Premium Gold: Return of the Bling | PGL2 | 1598 | Premium Gold 2 Booster (10 cards) | overlap 91/91 Namen (Expansion 91), recall 1, precision 1 | 111/0/0 |
| Premium Pack (TCG) | PP01 | 1087 | Premium Pack 1 Booster | overlap 15/15 Namen (Expansion 15), recall 1, precision 1 | 12/16/0 |
| Premium Pack 2 (TCG) | PP02 | 1145 | Premium Pack 2 Booster | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 10/20/0 |
| Speed Duel Demo Deck | DEM5 | 2704 | ohne nonsingles; z.B. Feral Imp / Battle Ox | overlap 10/11 Namen (Expansion 11), recall 0.909, precision 0.909 | 12/0/1 |
| Speed Duel Demo Deck 2020 | DEM6 | 4402 | ohne nonsingles; z.B. Power Up! (Skill) / Meteor Dragon | overlap 20/21 Namen (Expansion 21), recall 0.952, precision 0.952 | 24/0/1 |
| Speed Duel: Streets of Battle City | SBC1 | 5316 | Speed Duel: Streets of Battle City Box | overlap 191/191 Namen (Expansion 211), recall 1, precision 0.905 | 194/62/0 |
| Starter Deck 2006 | YSD | 1088 | GX Starter Deck 2006 | overlap 40/40 Namen (Expansion 40), recall 1, precision 1 | 48/2/0 |
| Starter Deck: Yu-Gi-Oh! 5D's | 5DS1 | 1173 | 5D's Starter Deck 2008 | overlap 43/43 Namen (Expansion 43), recall 1, precision 1 | 47/0/0 |
| Starter Deck: Yu-Gi-Oh! 5D's 2009 | 5DS2 | 1172 | 5D's Starter Deck 2009 | overlap 43/43 Namen (Expansion 43), recall 1, precision 1 | 51/0/0 |
| Structure Deck: Marik (TCG) | SDMA | 1220 | Structure Deck: Marik | overlap 38/38 Namen (Expansion 38), recall 1, precision 1 | 42/0/0 |
| The Lost Art Promotion (series) | LART | 2074 | ohne nonsingles; z.B. Monster Reborn / Right Leg of the Forbidden One | overlap 76/76 Namen (Expansion 78), recall 1, precision 0.974 | 148/9/0 |
| Tournament Pack: 1st Season | TP1 | 1076 | Tournament Pack 1 Booster | overlap 29/30 Namen (Expansion 31), recall 0.967, precision 0.935 | 2/56/2 |
| Tournament Pack: 2nd Season | TP2 | 1083 | Tournament Pack 2 Booster | overlap 30/30 Namen (Expansion 30), recall 1, precision 1 | 30/0/0 |
| Tournament Pack: 3rd Season | TP3 | 1058 | Tournament Pack 3 Booster | overlap 20/20 Namen (Expansion 20), recall 1, precision 1 | 20/0/0 |
| Turbo Pack: Booster One | TU01 | 1179 | Turbo Pack Booster | overlap 21/21 Namen (Expansion 21), recall 1, precision 1 | 26/0/0 |
| War of the Giants: Round 2 | BPW2 | 1472 | Battle Pack 2: War of the Giants - Round 2 Booster | overlap 103/103 Namen (Expansion 103), recall 1, precision 1 | 103/0/0 |
| Warriors' Strike Structure Deck | SDWS | 1180 | Structure Deck: Warrior's Strike | overlap 38/38 Namen (Expansion 38), recall 1, precision 1 | 42/0/0 |
| Winner's Pack 2026-2027 | WI26 | 6668 | Winner's Pack 2026-2027 OTS Stamp Booster | overlap 40/40 Namen (Expansion 40), recall 1, precision 1 | 0/59/0 |
| Yu-Gi-Oh! 3D Bonds Beyond Time Movie Pack | YMP1 | 1260 | 3D Bonds Beyond Time Movie Pack Booster | overlap 9/9 Namen (Expansion 9), recall 1, precision 1 | 10/0/0 |
| Yu-Gi-Oh! 5D's Duel Transer promotional cards | YDT1 | 1352 | ohne nonsingles; z.B. Ape Fighter / Closed Forest | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 0/3/0 |
| Yu-Gi-Oh! 5D's Stardust Accelerator promotional cards | WC09 | 1323 | ohne nonsingles; z.B. Infernity Archfiend / Infernity Dwarf | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 0/6/0 |
| Yu-Gi-Oh! 5D's Tag Force 4 promotional cards | TF04 | 1354 | ohne nonsingles; z.B. Warm Worm / Worm Bait | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 0/6/0 |
| Yu-Gi-Oh! 5D's Tag Force 5 promotional cards | TF05 | 1274 | ohne nonsingles; z.B. Fleur Synchron / Chevalier de Fleur | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 0/9/0 |
| Yu-Gi-Oh! 5D's Wheelie Breakers Promotional Cards | WB01 | 1252 | ohne nonsingles; z.B. Supersonic Skull Flame / Skull Flame | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 0/6/0 |
| Yu-Gi-Oh! 7 Trials to Glory: World Championship Tournament 2005 promotional cards | WC5 | 1125 | ohne nonsingles; z.B. Kaibaman / Mind Control | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! Advent Calendar (2018) | AC18 | 2311 | Advent Calendar 2018 | overlap 24/24 Namen (Expansion 24), recall 1, precision 1 | 25/0/0 |
| Yu-Gi-Oh! Advent Calendar (2019) | AC19 | 2664 | Advent Calendar 2019 | overlap 24/24 Namen (Expansion 24), recall 1, precision 1 | 29/0/0 |
| Yu-Gi-Oh! Capsule Monster Coliseum promotional cards | CMC | 1035 | ohne nonsingles; z.B. Abyss Soldier / Inferno Hammer | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! Championship Series 2010 Prize Cards | YCSW | 1461 | ohne nonsingles; z.B. Darklord Asmodeus / Darklord Superbia | overlap 14/14 Namen (Expansion 15), recall 1, precision 0.933 | 0/28/0 |
| Yu-Gi-Oh! Dark Duel Stories promotional cards | DDS | 1039 | ohne nonsingles; z.B. Acid Trap Hole / Blue-Eyes White Dragon | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Yu-Gi-Oh! Destiny Board Traveler promotional cards | DBT | 1110 | ohne nonsingles; z.B. D.D. Assailant / Emes the Infinity | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! Elemental Hero Collection 1 | EHC1 | 1403 | Elemental HERO Collection 1 | overlap 4/4 Namen (Expansion 4), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! Elemental Hero Collection 2 | EHC2 | 1404 | Elemental Hero Collection 2 | overlap 4/4 Namen (Expansion 4), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! Forbidden Memories promotional cards | FMR | 1124 | ohne nonsingles; z.B. Harpie's Pet Dragon / Metalmorph | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! GX Card Almanac promotional cards | YDB1 | 1091 | ohne nonsingles; z.B. Blizzard Dragon / Des Mosquito | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! GX Duel Academy promotional cards | GX1 | 1116 | ohne nonsingles; z.B. Elemental HERO Necroshade / Hero Ring | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! GX Spirit Caller promotional cards | GX03 | 1097 | ohne nonsingles; z.B. Brain Crusher / Hunter Owl | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! GX Tag Force 2 promotional cards | GX04 | 1101 | ohne nonsingles; z.B. Chaos Burst / Dark Bribe | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! GX Tag Force Evolution promotional cards | GX05 | 1098 | ohne nonsingles; z.B. Brutal Potion / Dark Cure | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! GX Tag Force promotional cards | GX02 | 1130 | ohne nonsingles; z.B. Phantom Beast Cross-Wing / Phantom Beast Thunder-Pegasus | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! GX Ultimate Beginner's Pack | UBP1 | 1120 | ohne nonsingles; z.B. Exodia the Forbidden One / Left Arm of the Forbidden One | overlap 5/5 Namen (Expansion 5), recall 1, precision 1 | 5/0/0 |
| Yu-Gi-Oh! Legacy of the Duelist: Link Evolution promotional cards | LOD2 | 2632 | ohne nonsingles; z.B. Progleo / Micro Coder | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! Nightmare Troubadour promotional cards | NTR | 1128 | ohne nonsingles; z.B. Magician's Circle / Silent Magician LV4 | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 5/0/0 |
| Yu-Gi-Oh! Power of Chaos: Joey the Passion promotional cards | PCJ | 1241 | ohne nonsingles; z.B. Red-Eyes Black Dragon / Sebek's Blessing | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Yu-Gi-Oh! Power of Chaos: Kaiba the Revenge promotional cards | PCK | 1062 | ohne nonsingles; z.B. Aqua Chorus / Blue-Eyes White Dragon | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 7/0/0 |
| Yu-Gi-Oh! Power of Chaos: Yugi the Destiny promotional cards | PCY | 1059 | ohne nonsingles; z.B. Anti-Spell Fragrance / Dark Magician | overlap 5/5 Namen (Expansion 5), recall 1, precision 1 | 13/0/0 |
| Yu-Gi-Oh! The Dark Side of Dimensions Movie Pack Secret Edition | MVP1 | 1711 | The Dark Side of Dimensions Movie Pack Booster | overlap 60/60 Namen (Expansion 60), recall 1, precision 1 | 0/215/0 |
| Yu-Gi-Oh! The Eternal Duelist Soul promotional cards | EDS | 1119 | ohne nonsingles; z.B. Exchange / Graceful Dice | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! Ultimate Masters: World Championship Tournament 2006 promotional cards | WC6 | 1122 | ohne nonsingles; z.B. Golden Homunculus / Helios - The Primordial Sun | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! World Championship 2007 promotional cards | WC07 | 1114 | ohne nonsingles; z.B. Destiny HERO - Disk Commander / Exploder Dragon | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! World Championship 2008 promotional cards | WC08 | 1324 | ohne nonsingles; z.B. Deep Diver / Burden of the Mighty | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! World Championship Qualifier National Championships 2011 prize cards | WQ11 | 1272 | ohne nonsingles; z.B. Meklord Astro Mekanikle / T.G. Hyper Librarian | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 3/0/0 |
| Yu-Gi-Oh! Worldwide Edition: Stairway to the Destined Duel promotional cards | SDD | 1123 | ohne nonsingles; z.B. Harpie's Feather Duster / Sinister Serpent | overlap 6/6 Namen (Expansion 6), recall 1, precision 1 | 6/0/0 |
| Yu-Gi-Oh! ZEXAL World Duel Carnival promotional cards | ZDC1 | 1492 | ohne nonsingles; z.B. Snow Plow Hustle Rustle / Night Express Knight | overlap 3/3 Namen (Expansion 3), recall 1, precision 1 | 4/0/0 |
| Zexal Collection Tin | ZTIN | 1433 | 2013 Zexal Collection Tin | overlap 24/24 Namen (Expansion 24), recall 1, precision 1 | 26/0/0 |

## Tests (03.11.)

- `node --test electron/cm-resolve-fixture.test.cjs electron/cardmarket-bulk-parse.test.cjs electron/catalog-build.test.cjs`: 72/72 bestanden
- `ELECTRON_RUN_AS_NODE=1 electron --test electron/cardmarket-bulk.test.cjs electron/catalog-build.test.cjs electron/catalog-builder.test.cjs`: 33/33 bestanden. Unter `node` scheitert `cardmarket-bulk.test.cjs` wie bisher am nativen better-sqlite3.
- `npm run lint`: 5 Fehler, alle Legacy
- `deno test --allow-read --node-modules-dir=none`:
  - `_shared`: 124 bestanden
  - `resolve-cm-product`: 51 bestanden
  - `refresh-cardmarket-prices`: 33 bestanden
- `deno check --node-modules-dir=none resolve-cm-product/index.ts refresh-cardmarket-prices/index.ts`: ok
