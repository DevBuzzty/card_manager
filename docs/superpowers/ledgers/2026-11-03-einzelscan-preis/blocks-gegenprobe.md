# Block-Regel: Gegenprobe (Spec 2026-11-03 §5.5) – 03.11.2026

**Ergebnis: 7 von 32 richtig (21,9 %). Die Schwelle liegt bei 97 %. `BLOCKS_AKTIV` bleibt `false`.** Mehrdeutige Drucke bleiben Spannen.

## Datenquelle
- **Desktop-DB:** eine Kopie von `%APPDATA%\yugioh-card-manager\cards.db`, angelegt am 03.11. um 15:16 im Scratchpad. Das Original wurde nicht geöffnet.
  In der Kopie fehlt die Spalte `cm_product_derived`, weil der installierte PC-Build älter ist als die Ableitung. Deshalb gelten alle IDs als echt.
  Auswahl: 3 041 Zeilen mit `cm_product_id is not null`, `deleted = 0` und `language <> 'KR'`. Daraus entstehen 2 713 `real`-Schlüssel, Konflikte sind schon entfernt.
- **Cardmarket:** `products_singles_3.json` (87 393 Singles), `products_nonsingles_3.json` (2 414), YGOPRODeck `cardsets.php` (1 036). Alle Dateien wurden am 03.11. frisch geladen.
- **Seltenheiten des Präfixes** (`printingRarities`): aus `printings` des Katalogs v11. Diese Liste stammt von YGOPRODeck `card_sets`.
- **Auswertung:** `buildCmIndex`, `blocksAus` und `learnedAus` aus `refresh-cardmarket-prices/cm_index.ts`, `blockRegel` aus `resolve-cm-product/blocks.ts`.
  Das Wegwerf-Skript liegt im Scratchpad (`messung/messung.ts`), nicht im Repo.

## Verfahren (Leave-one-out)
Gezählt wird jede `real`-Stichprobe, deren idProduct in einer Versionsgruppe mit n ≥ 2 liegt: **205 Fälle**. Für jeden Fall:
1. `blocks` ohne diese Stichprobe neu berechnen und die Block-Regel anwenden.
2. Zum Vergleich `learned` ohne diese Stichprobe neu berechnen und `deriveForExp` anwenden.

| Regel | anwendbar | richtig | Quote |
|---|---|---|---|
| Block-Regel | 32 | 7 | **21,9 %** |
| `deriveForExp` (Desktop-Regel, bleibt aktiv) | 127 | 124 | 97,6 % |

Wo die Block-Regel nicht greift (205 − 32 Fälle):

| Grund | Fälle |
|---|---|
| `no-median` | 126 |
| `count-mismatch` | 22 |
| `no-group` | 16 |
| `duplicate-rarity` | 9 |

## Warum die Block-Regel scheitert
Die Fehler sitzen fast alle in Sets mit späteren Nachdrucken. Ein Beispiel ist JUSH: Die echten IDs der Rares liegen bei 8376xx, die Regel wählt 8400xx.
Cardmarket hängt die IDs eines Nachdrucks als neuen Block an. Damit ergibt die Reihenfolge der Mediane keine Seltenheitsordnung mehr.
Ein zweites Beispiel ist L5DD Black Garden, Common/Ultra Rare: Dort liegen die Mediane in umgekehrter Reihenfolge.
Die Annahme „ein Block je Seltenheit“ hält also nur für die Erstauflage. Das Rangmodell in `deriveForExp` lernt die Position je (Expansion, n, Seltenheit) und kommt mit diesen Fällen zurecht.

## Folge
`resolve-cm-product/resolve.ts`: `BLOCKS_AKTIV = false` bleibt unverändert. Die Regel und ihre Tests bleiben im Code.
Erst eine neue Gegenprobe mit ≥ 97 % (zum Beispiel Mediane je Erstauflagen-Block) darf sie freischalten.
