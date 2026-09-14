# Spec G2 Preis-Alarme — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preis-Alarme (Bewegungsalarm + Zielpreise pro Printing), ausgewertet stündlich in der Cloud, gelesen und gepflegt auf Desktop und Handy, mit Windows-Benachrichtigung am Desktop.

**Architecture:** Eine Supabase Edge Function `evaluate-price-alerts` ist der einzige Auswerter (reine Regel in `alerts.ts`, Laden/Schreiben in `index.ts`), `pg_cron` ruft sie stündlich um :15. Desktop (Electron-Hauptprozess über den Sync-Client) und Handy (REST) lesen Treffer, erledigen sie und pflegen Regeln. Treffertexte und Eingabeprüfung sind getestete JS/Kotlin-Zwillinge gegen gemeinsame Fixtures.

**Tech Stack:** Deno (Edge Function, `jsr:@supabase/supabase-js@2`, `jsr:@std/assert@1`), Postgres/PostgREST, Electron CJS + better-sqlite3, React/Vite, Kotlin/Compose (Material3), OkHttp + org.json, kotlinx-coroutines-test.

**Spec:** `docs/superpowers/specs/2026-09-14-spec-g-nachtrag-g2-preis-alarme.md` (setzt G1 voraus: `docs/superpowers/specs/2026-09-14-spec-g-nachtrag-g1-preisverlauf-und-bewegungen.md`).

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase. SQL schreibt der Nutzer von Hand im Dashboard ein; der Plan liefert nur die SQL-Dateien. Ebenso deployt der Nutzer die Edge Function und legt den Cron-Job an.
- Immer explizite Pfade stagen, nie `git add -A`, nie `git stash` (der Stash-Stack ist mit den Worktrees geteilt).
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction.
- `cards.quantity` und `cards.deleted` pflegen Trigger, die App schreibt sie nie. Nur Soft-Delete.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte deutsch mit echten Umlauten, „Fächer" statt „Taschen". Gespeichertes `Unknown`/leer bei Set-Code und Rarität erscheint als „Unbekannt".
- Regeln wohnen in reinen, getesteten Helfern (Android `ml/`, Desktop `src/utils/` bzw. `electron/`, Cloud `supabase/functions/evaluate-price-alerts/alerts.ts`). Absichtliche Zwillinge werden im Kopfkommentar markiert und beidseitig getestet.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`); ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes nie aus englischen ableiten.
- „Heute" ist überall das UTC-Datum.
- kotlinx-coroutines-test: `advanceUntilIdle()` treibt Arbeit in `backgroundScope` NICHT an; eine Endlosschleife im Test-Scope darf nie mit `advanceUntilIdle()` getrieben werden (hängt) — `advanceTimeBy` + `runCurrent` benutzen. Für jeden Schutz-Test nachweisen, dass er ohne den Schutz scheitert (kurz sabotieren, Fehlschlag im Bericht zitieren, zurücknehmen).
- Teure Rechnungen nie ungemerkt in der Komposition (`remember`/Memo).
- Ein Platzhalter darf nie wie eine leere Liste aussehen.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

**Befehle (aus der Worktree-Wurzel):**
- Deno: `deno test --allow-read supabase/functions/evaluate-price-alerts/`
- Desktop-Hauptprozess (rein): `node --test desktop/electron/alert-notify.test.cjs desktop/electron/alert-text.test.cjs`
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`
- Android: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `supabase/functions/evaluate-price-alerts/families.ts` (neu) | Quellenfamilien, dritter Zwilling von `price-families.json` | 1 |
| `supabase/functions/evaluate-price-alerts/families_test.ts` (neu) | Vergleich gegen die JSON-Datei | 1 |
| `supabase/functions/evaluate-price-alerts/alerts.ts` (neu) | reine Auslöseregel | 1 |
| `supabase/functions/evaluate-price-alerts/alerts_test.ts` (neu) | Fixture-Tests | 1 |
| `docs/fixtures/portfolio/alerts.json` (neu) | Fälle der Auslöseregel | 1 |
| `supabase/functions/evaluate-price-alerts/index.ts` (neu) | Laden, auswerten, schreiben | 2 |
| `supabase/price_alerts_schema.sql` (neu) | Tabellen, RLS, Grants | 3 |
| `supabase/price_alerts_cron.sql` (neu) | stündlicher Job :15 | 3 |
| `desktop/electron/alert-text.cjs` + `.test.cjs` (neu) | Treffertexte JS | 4 |
| `android/.../ml/AlertText.kt` + `AlertTextTest.kt` (neu) | Treffertexte Kotlin | 4 |
| `docs/fixtures/portfolio/alert-texts.json` (neu) | gemeinsame Text-Fixture | 4 |
| `desktop/electron/alert-notify.cjs` + `.test.cjs` (neu) | Benachrichtigungs-Entscheidung | 5 |
| `desktop/electron/sync.cjs` | Sync-Schritt Preis-Alarme | 5 |
| `desktop/electron/main.cjs`, `preload.cjs` | IPC, Notification, Navigation | 5 |
| `desktop/src/utils/usePriceAlertEvents.js` (neu) | Laden der offenen Treffer | 6 |
| `desktop/src/components/PriceAlertsList.jsx`, `PriceAlertsCard.jsx`, `PriceAlertsPanel.jsx` (neu) | Liste, Start-Karte, Insights-Reiter | 6 |
| `desktop/src/components/Start.jsx`, `Insights.jsx`, `Deals.jsx`, `src/App.jsx` | Einbau, Reiter, Titel, Navigation | 6 |
| `desktop/src/utils/alertInput.js` + `.test.js` (neu) | Eingabeprüfung JS | 7 |
| `docs/fixtures/portfolio/alert-input.json` (neu) | gemeinsame Eingabe-Fixture | 7 |
| `desktop/src/components/PriceAlertTargets.jsx`, `PriceAlertSettings.jsx` (neu) | Karten-Panel-Zeile, Einstellungen | 7 |
| `desktop/src/components/CardDetailPanel.jsx`, `Settings.jsx` | Einbau | 7 |
| `android/.../ml/AlertInput.kt` + `AlertInputTest.kt` (neu) | Eingabeprüfung Kotlin | 8 |
| `android/.../ml/ForegroundTick.kt` + `ForegroundTickTest.kt` (neu) | Vordergrund-Nachladen | 8 |
| `android/.../cloud/PriceAlertsRepository.kt` + `PriceAlertsQueriesTest.kt` (neu) | REST | 8 |
| `android/.../cloud/SideStores.kt`, `ui/AppNav.kt` | Speicher, Vordergrund-Hook | 8 |
| `android/.../ui/PriceAlertsSection.kt`, `PriceAlertTargetsRow.kt`, `PriceAlertSettings.kt` (neu) | Handy-Ansichten | 9 |
| `android/.../ui/StartScreen.kt`, `InsightsScreen.kt`, `CardDetailScreen.kt`, `SettingsScreen.kt`, `AppNav.kt` | Einbau | 9 |

`android/...` = `android/app/src/main/java/com/example/yugiohscanner`, Tests unter `android/app/src/test/java/com/example/yugiohscanner/` (Paket `com.example.yugiohscanner`, Fixture-Lesen über `Fixtures.text("docs/fixtures/...")`).

**Bewusste Ergänzungen gegenüber der Spec (vom Plan entschieden, im Ledger vermerkt):**
1. Die Desktop-Eingabeprüfung ist ein Zwilling von `ml/AlertInput.kt` (`src/utils/alertInput.js`, gemeinsame Fixture) — Spec §7 nennt nur die Kotlin-Seite, die Regel „Regeln in getesteten Helfern" gilt aber auch am Desktop.
2. Der Sync-Schritt lädt alle offenen Treffer (max. 200) statt nur `id > Marke`: `nextNotification` filtert selbst, und so erreicht ein „Erledigt" am Handy den Desktop (`price-alerts-changed` bei geänderter Menge offener IDs).
3. Leere Marke ohne Treffer wird zu `0` (sonst würde der erste echte Treffer still verschluckt).
4. Der Treffertext für die Desktop-Liste wird im Hauptprozess erzeugt (`alert-text.cjs`), der Renderer zeigt `event.text` — es gibt so nur eine JS-Fassung.
5. Das Schema-SQL gewährt `service_role` Ausführung von `price_reference` (G1 hat nur `authenticated` berechtigt).

---
### Task 1: Auslöseregel in der Cloud (reine Regel, Familien, Fixture)

**Files:**
- Create: `supabase/functions/evaluate-price-alerts/families.ts`
- Create: `supabase/functions/evaluate-price-alerts/families_test.ts`
- Create: `supabase/functions/evaluate-price-alerts/alerts.ts`
- Create: `supabase/functions/evaluate-price-alerts/alerts_test.ts`
- Create: `docs/fixtures/portfolio/alerts.json`

**Interfaces:**
- Consumes: `desktop/electron/price-families.json` (nur im Test).
- Produces (für Task 2): `evaluate(input: EvaluateInput): EvaluateResult`, `keyOf(cardId, setCode, language, rarity): string`, `addDays(day, n): string`, Typen `Rule`, `Printing`, `Reference`, `RecentEvent`, `AlertEvent`, `EvaluateInput`, `EvaluateResult` — genau wie unten.

- [ ] **Step 1: Familien-Test schreiben**

`supabase/functions/evaluate-price-alerts/families_test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { FAMILIES, familyOfLock, familyOfSource } from "./families.ts";

Deno.test("families: gleicht desktop/electron/price-families.json", async () => {
  const json = JSON.parse(
    await Deno.readTextFile(new URL("../../../desktop/electron/price-families.json", import.meta.url)),
  );
  assertEquals(FAMILIES, json);
});

Deno.test("families: unbekannte Quelle und Sperre", () => {
  assertEquals(familyOfSource("irgendwas"), "unknown");
  assertEquals(familyOfSource(null), "unknown");
  assertEquals(familyOfSource("toString"), "unknown");
  assertEquals(
    [familyOfLock(null), familyOfLock(0), familyOfLock(1), familyOfLock(2), familyOfLock(7)],
    ["ygo", "ygo", "cm", "manual", "unknown"],
  );
});
```

- [ ] **Step 2: Fixture schreiben**

`docs/fixtures/portfolio/alerts.json` (heute ist in allen Fällen `2026-09-14`, also Stichtag 7 Tage = `2026-09-07`, 30 Tage = `2026-08-15`):
```json
{
  "_comment": "Spec G2 §5 — Faelle der Ausloeseregel supabase/functions/evaluate-price-alerts/alerts.ts (alerts_test.ts).",
  "cases": [
    {
      "name": "move: Grenze exakt 20 % und 2 € löst aus",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 1, "kind": "move", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 10, "new_price": 12, "pct": 20, "days": 7, "threshold": null, "day": "2026-09-14" }],
        "armedUpdates": []
      }
    },
    {
      "name": "move: 1,99 € unter der €-Grenze trotz 50 %",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 5.97, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 3.98, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "move: 19,9 % unter der %-Grenze trotz 3,98 €",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 23.98, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 20, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "move: Rückgang löst aus",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 15, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-05", "price": 20, "source": "cloud" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 1, "kind": "move", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 20, "new_price": 15, "pct": -25, "days": 7, "threshold": null, "day": "2026-09-14" }],
        "armedUpdates": []
      }
    },
    {
      "name": "move: Quellenwechsel YGOPRODeck → Cardmarket zählt nicht",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "ygoprodeck" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "move: manueller Preis zählt nicht",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 2 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "manual" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "move: kein Damals (Referenz jünger als das Fenster)",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-10", "price": 10, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "move: Sperre durch Treffer im Fenster",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": [{ "rule_id": 1, "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-08" }]
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "move: neuer Treffer, sobald der alte aus dem Fenster fällt",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": [{ "rule_id": 1, "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07" }]
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 1, "kind": "move", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 10, "new_price": 12, "pct": 20, "days": 7, "threshold": null, "day": "2026-09-14" }],
        "armedUpdates": []
      }
    },
    {
      "name": "move: Treffer einer anderen Regel sperrt nicht",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": [{ "rule_id": 99, "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-10" }]
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 1, "kind": "move", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 10, "new_price": 12, "pct": 20, "days": 7, "threshold": null, "day": "2026-09-14" }],
        "armedUpdates": []
      }
    },
    {
      "name": "move: 30-Tage-Fenster nutzt die 30er-Referenz",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 30, "threshold": null, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": {
          "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 12, "source": "cm_bulk" }],
          "30": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-08-15", "price": 10, "source": "cloud" }]
        },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 1, "kind": "move", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 10, "new_price": 12, "pct": 20, "days": 30, "threshold": null, "day": "2026-09-14" }],
        "armedUpdates": []
      }
    },
    {
      "name": "above: erfüllt und scharf löst aus und entschärft",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 2, "user_id": "u1", "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 50, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 50, "price_locked": 1 }],
        "references": {},
        "lastBefore": { "1|LOB-DE001|DE|Ultra Rare": 45.5 },
        "recentEvents": []
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 2, "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 45.5, "new_price": 50, "pct": null, "days": null, "threshold": 50, "day": "2026-09-14" }],
        "armedUpdates": [{ "id": 2, "armed": false }]
      }
    },
    {
      "name": "above: erfüllt, aber entschärft bleibt still",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 2, "user_id": "u1", "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 50, "armed": false }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 60, "price_locked": 1 }],
        "references": {},
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "above: wieder unter der Schwelle wird scharf",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 2, "user_id": "u1", "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 50, "armed": false }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 49.99, "price_locked": 1 }],
        "references": {},
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [{ "id": 2, "armed": true }] }
    },
    {
      "name": "above: scharf und nicht erfüllt bleibt still",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 2, "user_id": "u1", "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 50, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 10, "price_locked": 1 }],
        "references": {},
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "below: sofort erfüllt ohne Vorpreis",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 3, "user_id": "u1", "kind": "below", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 5, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 4, "price_locked": 0 }],
        "references": {},
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 3, "kind": "below", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": null, "new_price": 4, "pct": null, "days": null, "threshold": 5, "day": "2026-09-14" }],
        "armedUpdates": [{ "id": 3, "armed": false }]
      }
    },
    {
      "name": "below: manueller Preis zählt, Grenze exakt",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 3, "user_id": "u1", "kind": "below", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 5, "armed": true }],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 5, "price_locked": 2 }],
        "references": {},
        "lastBefore": { "1|LOB-DE001|DE|Ultra Rare": 7 },
        "recentEvents": []
      },
      "expected": {
        "events": [{ "user_id": "u1", "rule_id": 3, "kind": "below", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 7, "new_price": 5, "pct": null, "days": null, "threshold": 5, "day": "2026-09-14" }],
        "armedUpdates": [{ "id": 3, "armed": false }]
      }
    },
    {
      "name": "Zielpreis: weggefallenes Printing ändert nichts",
      "input": {
        "today": "2026-09-14",
        "rules": [{ "id": 2, "user_id": "u1", "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 50, "armed": false }],
        "printings": [],
        "references": {},
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": { "events": [], "armedUpdates": [] }
    },
    {
      "name": "Bewegung und Zielpreis im selben Lauf, Reihenfolge der Regeln",
      "input": {
        "today": "2026-09-14",
        "rules": [
          { "id": 1, "user_id": "u1", "kind": "move", "card_id": null, "set_code": null, "language": null, "rarity": null, "pct": 20, "min_eur": 2, "days": 7, "threshold": null, "armed": true },
          { "id": 2, "user_id": "u1", "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "pct": null, "min_eur": null, "days": null, "threshold": 12, "armed": true }
        ],
        "printings": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "price": 12, "price_locked": 1 }],
        "references": { "7": [{ "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-07", "price": 10, "source": "cm_bulk" }] },
        "lastBefore": {},
        "recentEvents": []
      },
      "expected": {
        "events": [
          { "user_id": "u1", "rule_id": 1, "kind": "move", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": 10, "new_price": 12, "pct": 20, "days": 7, "threshold": null, "day": "2026-09-14" },
          { "user_id": "u1", "rule_id": 2, "kind": "above", "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "old_price": null, "new_price": 12, "pct": null, "days": null, "threshold": 12, "day": "2026-09-14" }
        ],
        "armedUpdates": [{ "id": 2, "armed": false }]
      }
    }
  ]
}
```

- [ ] **Step 3: Regel-Test schreiben**

`supabase/functions/evaluate-price-alerts/alerts_test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { evaluate, type EvaluateInput } from "./alerts.ts";

// Spec G2 §10 — Faelle in docs/fixtures/portfolio/alerts.json.
const FIX = JSON.parse(
  await Deno.readTextFile(new URL("../../../docs/fixtures/portfolio/alerts.json", import.meta.url)),
) as { cases: { name: string; input: EvaluateInput; expected: unknown }[] };

for (const c of FIX.cases) {
  Deno.test(`alerts: ${c.name}`, () => {
    assertEquals(evaluate(c.input), c.expected);
  });
}
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag bestätigen**

Run: `deno test --allow-read supabase/functions/evaluate-price-alerts/`
Expected: FAIL — Modul `./families.ts` bzw. `./alerts.ts` nicht gefunden.

- [ ] **Step 5: `families.ts` schreiben**

```ts
// Spec G2 §5.3 — Quellenfamilien (Spec G1 §4.2).
// DRITTER ZWILLING von desktop/electron/price-families.json (Desktop: electron/movers.cjs) und
// android/app/src/main/java/com/example/yugiohscanner/ml/PriceFamily.kt. families_test.ts vergleicht
// gegen die JSON-Datei. Wer eine Seite aendert, aendert alle drei.
export const FAMILIES: Record<string, string> = {
  cm_bulk: "cm",
  cm_scrape: "cm",
  cloud: "cm",
  ygoprodeck: "ygo",
  manual: "manual",
};

export function familyOfSource(source: string | null | undefined): string {
  return source != null && Object.hasOwn(FAMILIES, source) ? FAMILIES[source] : "unknown";
}

// Familie des aktuellen Preises aus cards.price_locked (0 YGOPRODeck, 1 Cardmarket, 2 manuell).
export function familyOfLock(priceLocked: number | null | undefined): string {
  const n = priceLocked == null ? 0 : Number(priceLocked);
  if (n === 0) return "ygo";
  if (n === 1) return "cm";
  if (n === 2) return "manual";
  return "unknown";
}
```

- [ ] **Step 6: `alerts.ts` schreiben**

```ts
// Spec G2 §5 — wann ein Preis-Alarm ausloest. Reine Regel ohne Netz; index.ts laedt und schreibt.
// Bewegungsalarm mit derselben Familienregel wie Spec G1 §4.2 (electron/movers.cjs, ml/Movers.kt).
import { familyOfLock, familyOfSource } from "./families.ts";

export type Rule = {
  id: number;
  user_id: string;
  kind: "move" | "above" | "below";
  card_id: string | null;
  set_code: string | null;
  language: string | null;
  rarity: string | null;
  pct: number | null;
  min_eur: number | null;
  days: number | null;
  threshold: number | null;
  armed: boolean;
};

/** Ein Printing mit deleted = false, lebender Kopie und price > 0. */
export type Printing = {
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  price: number;
  price_locked: number | null;
};

/** Eine Zeile der RPC price_reference(days). */
export type Reference = {
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  day: string;
  price: number;
  source: string;
};

export type RecentEvent = {
  rule_id: number;
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  day: string;
};

export type AlertEvent = {
  user_id: string;
  rule_id: number;
  kind: Rule["kind"];
  card_id: string;
  set_code: string;
  language: string;
  rarity: string;
  old_price: number | null;
  new_price: number;
  pct: number | null;
  days: number | null;
  threshold: number | null;
  day: string;
};

export type EvaluateInput = {
  /** UTC-Datum YYYY-MM-DD. */
  today: string;
  /** Nur aktive Regeln. */
  rules: Rule[];
  printings: Printing[];
  /** Zeilen der RPC price_reference je Fenster; Schluessel "7" bzw. "30". */
  references: Record<string, Reference[]>;
  /** Letzter Verlaufspreis vor heute je Printing-Schluessel (nur fuer Zielpreise). */
  lastBefore: Record<string, number>;
  /** Treffer der letzten 30 Tage (Fenster-Sperre des Bewegungsalarms). */
  recentEvents: RecentEvent[];
};

export type EvaluateResult = {
  events: AlertEvent[];
  armedUpdates: { id: number; armed: boolean }[];
};

export const keyOf = (
  cardId: string | null,
  setCode: string | null,
  language: string | null,
  rarity: string | null,
): string => `${cardId}|${setCode || "Unknown"}|${language || "DE"}|${rarity || "Unknown"}`;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round = (x: number, f: number) => Math.round(x * f) / f;

/** Treffer in Reihenfolge der Regeln, innerhalb einer Bewegungsregel in Reihenfolge der Printings. */
export function evaluate(input: EvaluateInput): EvaluateResult {
  const events: AlertEvent[] = [];
  const armedUpdates: { id: number; armed: boolean }[] = [];
  const byKey = new Map<string, Printing>();
  for (const p of input.printings) byKey.set(keyOf(p.card_id, p.set_code, p.language, p.rarity), p);

  for (const rule of input.rules) {
    if (rule.kind === "move") evaluateMove(rule, input, events);
    else evaluateTarget(rule, input, byKey, events, armedUpdates);
  }
  return { events, armedUpdates };
}

// §5.1: Damals nur bei day <= heute - days; gleiche Familie, nicht manual/unknown; beide Grenzen;
// kein neuer Treffer, solange ein Treffer derselben Regel mit day > heute - days existiert.
function evaluateMove(rule: Rule, input: EvaluateInput, events: AlertEvent[]) {
  const days = Number(rule.days);
  const cutoff = addDays(input.today, -days);
  const refs = new Map<string, Reference>();
  for (const r of input.references[String(days)] ?? []) {
    refs.set(keyOf(r.card_id, r.set_code, r.language, r.rarity), r);
  }
  const blocked = new Set<string>();
  for (const e of input.recentEvents) {
    if (e.rule_id === rule.id && e.day > cutoff) blocked.add(keyOf(e.card_id, e.set_code, e.language, e.rarity));
  }
  for (const p of input.printings) {
    const k = keyOf(p.card_id, p.set_code, p.language, p.rarity);
    const ref = refs.get(k);
    if (!ref || ref.day > cutoff || blocked.has(k)) continue;
    const oldPrice = Number(ref.price);
    const newPrice = Number(p.price);
    if (!(oldPrice > 0) || !(newPrice > 0)) continue;
    const fam = familyOfSource(ref.source);
    if (fam !== familyOfLock(p.price_locked) || fam === "manual" || fam === "unknown") continue;
    const deltaUnit = round(newPrice - oldPrice, 100);
    const pct = round(((newPrice - oldPrice) / oldPrice) * 100, 10);
    if (Math.abs(deltaUnit) < Number(rule.min_eur) || Math.abs(pct) < Number(rule.pct)) continue;
    events.push({
      user_id: rule.user_id,
      rule_id: rule.id,
      kind: "move",
      card_id: p.card_id,
      set_code: p.set_code,
      language: p.language,
      rarity: p.rarity,
      old_price: oldPrice,
      new_price: newPrice,
      pct,
      days,
      threshold: null,
      day: input.today,
    });
  }
}

// §5.2: einmal pro Ueberschreiten. Fehlt das Printing, weder Treffer noch armed-Aenderung.
function evaluateTarget(
  rule: Rule,
  input: EvaluateInput,
  byKey: Map<string, Printing>,
  events: AlertEvent[],
  armedUpdates: { id: number; armed: boolean }[],
) {
  const k = keyOf(rule.card_id, rule.set_code, rule.language, rule.rarity);
  const p = byKey.get(k);
  if (!p) return;
  const price = Number(p.price);
  const threshold = Number(rule.threshold);
  const met = rule.kind === "above" ? price >= threshold : price <= threshold;
  if (met && rule.armed) {
    events.push({
      user_id: rule.user_id,
      rule_id: rule.id,
      kind: rule.kind,
      card_id: p.card_id,
      set_code: p.set_code,
      language: p.language,
      rarity: p.rarity,
      old_price: input.lastBefore[k] ?? null,
      new_price: price,
      pct: null,
      days: null,
      threshold,
      day: input.today,
    });
    armedUpdates.push({ id: rule.id, armed: false });
  } else if (!met && !rule.armed) {
    armedUpdates.push({ id: rule.id, armed: true });
  }
}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `deno test --allow-read supabase/functions/evaluate-price-alerts/`
Expected: PASS, 21 Tests (19 Fixture-Fälle + 2 Familien-Tests). Außerdem `deno test --allow-read supabase/functions/refresh-cardmarket-prices/` unverändert grün.

- [ ] **Step 8: Schutz-Nachweis**

Kurz sabotieren und Fehlschlag im Bericht zitieren, dann zurücknehmen: (a) in `evaluateMove` die Zeile `blocked.has(k) ||` entfernen → Fall „Sperre durch Treffer im Fenster" scheitert; (b) in `evaluateTarget` `&& rule.armed` entfernen → Fall „erfüllt, aber entschärft bleibt still" scheitert.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/evaluate-price-alerts/families.ts supabase/functions/evaluate-price-alerts/families_test.ts supabase/functions/evaluate-price-alerts/alerts.ts supabase/functions/evaluate-price-alerts/alerts_test.ts docs/fixtures/portfolio/alerts.json
git commit -m "feat(g2): Ausloeseregel der Preis-Alarme als reiner Deno-Helfer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Edge Function `evaluate-price-alerts` (Laden und Schreiben)

**Files:**
- Create: `supabase/functions/evaluate-price-alerts/index.ts`

**Interfaces:**
- Consumes (Task 1): `evaluate`, `keyOf`, `addDays`, Typen `Printing`, `Reference`, `RecentEvent`, `Rule` aus `./alerts.ts`.
- Consumes (Task 3, erst beim Nutzer live): Tabellen `price_alert_rules`, `price_alert_events`; RPC `price_reference(days)` (G1).
- Produces: HTTP-Endpunkt; Antwort `{ rules, events, armed }` bzw. `{ error }` mit 401/500.

Kein Unit-Test (die Regel ist in Task 1 getestet); Prüfung per `deno check`. **Niemals deployen oder aufrufen** — das macht der Nutzer.

- [ ] **Step 1: `index.ts` schreiben**

```ts
// Supabase Edge Function: Preis-Alarme auswerten (Spec G2 §3, §5).
// Einziger Auswerter — Desktop und Handy lesen nur. Laeuft stuendlich um :15 per pg_cron
// (supabase/price_alerts_cron.sql).
// Deploy (aus dem Repo-Stammverzeichnis):
//   supabase functions deploy evaluate-price-alerts --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
//   (--no-verify-jwt, damit pg_cron sie aufrufen kann; Schutz ist das optionale Geheimnis unten)
// Secrets: SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY kommen automatisch. Optional ALERTS_TRIGGER_SECRET
//   setzen — dann braucht jeder Aufruf den Header `x-alerts-secret`.
// Einzelnutzer-Modell: cards/card_copies/price_history haben kein user_id; jede Regel wird gegen
// denselben Bestand ausgewertet (wie die Deals-Tabellen es fuer Treffer mit user_id tun).

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  addDays,
  evaluate,
  keyOf,
  type Printing,
  type RecentEvent,
  type Reference,
  type Rule,
} from "./alerts.ts";

const PAGE = 1000;

type PageResult = { data: unknown; error: { message: string } | null };

// PostgREST liefert hoechstens ~1000 Zeilen je Antwort: seitenweise ueber eine STABILE Ordnung lesen.
async function all<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0;; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

type Keyed = { set_code: string | null; language: string | null; rarity: string | null };
const norm = <T extends Keyed>(r: T): T => ({
  ...r,
  set_code: r.set_code || "Unknown",
  language: r.language || "DE",
  rarity: r.rarity || "Unknown",
});

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

async function loadRules(sb: SupabaseClient): Promise<Rule[]> {
  const rows = await all<Rule>((f, t) =>
    sb.from("price_alert_rules").select("*").eq("active", true).order("id").range(f, t)
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    pct: numOrNull(r.pct),
    min_eur: numOrNull(r.min_eur),
    days: numOrNull(r.days),
    threshold: numOrNull(r.threshold),
    armed: !!r.armed,
  }));
}

// §5: Printings mit deleted = false, mindestens einem lebenden Exemplar und price > 0.
async function loadPrintings(sb: SupabaseClient): Promise<Printing[]> {
  const cards = await all<Printing>((f, t) =>
    sb.from("cards")
      .select("card_id:id,set_code,language,rarity,price,price_locked")
      .eq("deleted", false)
      .gt("price", 0)
      .order("id").order("set_code").order("language").order("rarity")
      .range(f, t)
  );
  const copies = await all<{ card_id: string; set_code: string; language: string; rarity: string }>((f, t) =>
    sb.from("card_copies")
      .select("card_id,set_code,language,rarity")
      .eq("deleted", false)
      .order("copy_id")
      .range(f, t)
  );
  const owned = new Set(copies.map((c) => keyOf(String(c.card_id), c.set_code, c.language, c.rarity)));
  return cards
    .map((c) => norm({ ...c, card_id: String(c.card_id), price: Number(c.price), price_locked: numOrNull(c.price_locked) }))
    .filter((c) => owned.has(keyOf(c.card_id, c.set_code, c.language, c.rarity)));
}

// Dieselbe RPC wie Spec G1 (Handy-Bewegungen), damit Damals ueberall gleich gewaehlt wird.
async function loadReferences(sb: SupabaseClient, days: number): Promise<Reference[]> {
  const rows = await all<Reference>((f, t) =>
    sb.rpc("price_reference", { days })
      .order("card_id").order("set_code").order("language").order("rarity")
      .range(f, t)
  );
  return rows.map((r) => norm({ ...r, card_id: String(r.card_id), price: Number(r.price) }));
}

// §5.2: old_price eines Zielpreis-Treffers = letzter Verlaufspreis vor heute.
async function loadLastBefore(sb: SupabaseClient, rules: Rule[], today: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of rules) {
    if (r.kind === "move") continue;
    const k = keyOf(r.card_id, r.set_code, r.language, r.rarity);
    if (seen.has(k)) continue;
    seen.add(k);
    const { data, error } = await sb.from("price_history")
      .select("price")
      .eq("card_id", r.card_id).eq("set_code", r.set_code).eq("language", r.language).eq("rarity", r.rarity)
      .eq("variant", "base")
      .lt("day", today)
      .order("day", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    if (data && data.length > 0) out[k] = Number(data[0].price);
  }
  return out;
}

async function loadRecentEvents(sb: SupabaseClient, today: string): Promise<RecentEvent[]> {
  const rows = await all<RecentEvent>((f, t) =>
    sb.from("price_alert_events")
      .select("rule_id,card_id,set_code,language,rarity,day")
      .eq("kind", "move")
      .gt("day", addDays(today, -30))
      .order("id")
      .range(f, t)
  );
  return rows.map((e) => ({ ...e, rule_id: Number(e.rule_id) }));
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("ALERTS_TRIGGER_SECRET");
  if (secret && req.headers.get("x-alerts-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const rules = await loadRules(sb);
    if (rules.length === 0) return json({ rules: 0, events: 0, armed: 0 });

    const printings = await loadPrintings(sb);
    const references: Record<string, Reference[]> = {};
    for (const d of new Set(rules.filter((r) => r.kind === "move").map((r) => Number(r.days)))) {
      references[String(d)] = await loadReferences(sb, d);
    }
    const lastBefore = await loadLastBefore(sb, rules, today);
    const recentEvents = await loadRecentEvents(sb, today);

    const { events, armedUpdates } = evaluate({ today, rules, printings, references, lastBefore, recentEvents });

    // §5.3: erst Treffer (idempotent pro Tag), dann armed — ein Abbruch verliert so nie einen Treffer.
    let inserted = 0;
    for (let i = 0; i < events.length; i += 500) {
      const { data, error } = await sb.from("price_alert_events")
        .upsert(events.slice(i, i + 500), {
          onConflict: "rule_id,card_id,set_code,language,rarity,day",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw new Error(error.message);
      inserted += data?.length ?? 0;
    }
    for (const u of armedUpdates) {
      const { error } = await sb.from("price_alert_rules").update({ armed: u.armed }).eq("id", u.id);
      if (error) throw new Error(error.message);
    }

    console.log(
      `[evaluate-price-alerts] rules=${rules.length} printings=${printings.length} new=${inserted} armed=${armedUpdates.length}`,
    );
    // Nur Zaehler — nie Inhalte fremder Regeln.
    return json({ rules: rules.length, events: inserted, armed: armedUpdates.length });
  } catch (e) {
    console.error("[evaluate-price-alerts]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
```

- [ ] **Step 2: Typprüfung**

Run: `deno check supabase/functions/evaluate-price-alerts/index.ts`
Expected: keine Fehler. Scheitert die Prüfung **nur** an Supabase-Generics (z. B. Rückgabetyp von `sb.rpc(...)`/`.select(...)` nicht zuweisbar), den Parameter `sb` in den Ladefunktionen als `any` typisieren (wie `scrape-deals` es mit `w: any` tut, Kommentar `// untypisierter Client, keine generierten DB-Typen`) — keine Logikänderung. Andere Fehler beheben.

- [ ] **Step 3: Regel-Tests weiter grün**

Run: `deno test --allow-read supabase/functions/evaluate-price-alerts/`
Expected: PASS (21).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/evaluate-price-alerts/index.ts
git commit -m "feat(g2): Edge Function evaluate-price-alerts laedt, wertet aus und schreibt

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: SQL für Tabellen und Cron (nur Dateien, nichts ausführen)

**Files:**
- Create: `supabase/price_alerts_schema.sql`
- Create: `supabase/price_alerts_cron.sql`

**Interfaces:**
- Produces: `public.price_alert_rules`, `public.price_alert_events` genau mit den Spalten, Constraints und Konfliktschlüsseln, die Task 2, 5 und 8 benutzen: Upsert-Konflikt Zielpreis `user_id,kind,card_id,set_code,language,rarity`; Treffer-Konflikt `rule_id,card_id,set_code,language,rarity,day`.

- [ ] **Step 1: `supabase/price_alerts_schema.sql` schreiben**

```sql
-- supabase/price_alerts_schema.sql — Spec G2 §4. Einmal im Dashboard einspielen (idempotent).
-- Setzt voraus: public.set_updated_at() (supabase/schema.sql) und public.price_reference (G1,
-- supabase/price_reference_rpc.sql). Ausgewertet wird nur von der Edge Function evaluate-price-alerts.

create table if not exists public.price_alert_rules (
  id          bigint generated by default as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('move', 'above', 'below')),
  card_id     text,
  set_code    text,
  language    text,
  rarity      text,
  pct         numeric check (pct between 1 and 500),
  min_eur     numeric check (min_eur >= 0),
  days        integer check (days in (7, 30)),
  threshold   numeric check (threshold > 0),
  armed       boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- move: global, ohne Printing, mit pct/min_eur/days. above/below: ein Printing mit threshold.
  constraint price_alert_rules_shape check (
    (kind = 'move'
      and card_id is null and set_code is null and language is null and rarity is null
      and pct is not null and min_eur is not null and days is not null and threshold is null)
    or
    (kind in ('above', 'below')
      and card_id is not null and set_code is not null and language is not null and rarity is not null
      and threshold is not null and pct is null and min_eur is null and days is null)
  ),
  -- Hoechstens ein above und ein below je Printing. Bei move sind die Schluesselspalten null und
  -- kollidieren deshalb nicht; dafuer sorgt der Teilindex unten.
  constraint price_alert_rules_target_unique unique (user_id, kind, card_id, set_code, language, rarity)
);

create unique index if not exists price_alert_rules_one_move
  on public.price_alert_rules (user_id) where kind = 'move';

drop trigger if exists price_alert_rules_updated_at on public.price_alert_rules;
create trigger price_alert_rules_updated_at
  before insert or update on public.price_alert_rules
  for each row execute function public.set_updated_at();

create table if not exists public.price_alert_events (
  id          bigint generated by default as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  rule_id     bigint not null references public.price_alert_rules (id) on delete cascade,
  kind        text not null check (kind in ('move', 'above', 'below')),
  card_id     text not null,
  set_code    text not null,
  language    text not null,
  rarity      text not null,
  old_price   numeric,
  new_price   numeric not null,
  pct         numeric,
  days        integer,
  threshold   numeric,
  day         date not null,
  created_at  timestamptz not null default now(),
  dismissed   boolean not null default false,
  constraint price_alert_events_dedup unique (rule_id, card_id, set_code, language, rarity, day)
);

create index if not exists price_alert_events_open
  on public.price_alert_events (user_id, dismissed, id desc);

alter table public.price_alert_rules  enable row level security;
alter table public.price_alert_events enable row level security;

drop policy if exists "price alert rules are private" on public.price_alert_rules;
create policy "price alert rules are private" on public.price_alert_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "price alert events are private" on public.price_alert_events;
create policy "price alert events are private" on public.price_alert_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- (Die Edge Function nutzt den Service-Role-Schluessel, der RLS umgeht.)
-- G1 hat price_reference nur fuer authenticated freigegeben; der Auswerter laeuft als service_role.
grant execute on function public.price_reference(integer) to service_role;
```

- [ ] **Step 2: `supabase/price_alerts_cron.sql` schreiben**

```sql
-- supabase/price_alerts_cron.sql — Spec G2 §3/§11. Erst NACH dem Deploy der Funktion einspielen.
-- Stuendlich um :15 (die Cardmarket-Aktualisierung laeuft um 05:00 UTC, der 05:15-Lauf sieht sie also).
-- Idempotent: ein vorhandener Job gleichen Namens wird zuerst entfernt.
-- Ist das Secret ALERTS_TRIGGER_SECRET gesetzt, im headers-JSON zusaetzlich
--   "x-alerts-secret": "<geheimnis>"
-- eintragen.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'evaluate-price-alerts';

select cron.schedule(
  'evaluate-price-alerts',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/evaluate-price-alerts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Gegenprüfung ohne Datenbank**

Prüfen (lesend, per Grep), dass die Konfliktschlüssel mit dem Code übereinstimmen:
`rule_id,card_id,set_code,language,rarity,day` steht in `index.ts` und im Constraint `price_alert_events_dedup`; die Spaltenliste `user_id, kind, card_id, set_code, language, rarity` steht im Constraint `price_alert_rules_target_unique`. Nichts ausführen, nicht mit Supabase verbinden.

- [ ] **Step 4: Commit**

```bash
git add supabase/price_alerts_schema.sql supabase/price_alerts_cron.sql
git commit -m "feat(g2): SQL fuer Preis-Alarm-Tabellen und stuendlichen Cron-Job

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Treffertexte als Zwilling (JS und Kotlin)

**Files:**
- Create: `docs/fixtures/portfolio/alert-texts.json`
- Create: `desktop/electron/alert-text.cjs`
- Create: `desktop/electron/alert-text.test.cjs`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/AlertText.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/AlertTextTest.kt`

**Interfaces:**
- Produces (für Task 5): `alertText(e)` mit `e = { kind, name, card_id, set_code, rarity, old_price, new_price, pct, days, threshold }` → string; außerdem `eur(value)`, `signedPct(value)`.
- Produces (für Task 9): `AlertText.of(kind: String, name: String?, cardId: String, setCode: String?, rarity: String?, oldPrice: Double?, newPrice: Double, pct: Double?, days: Int?, threshold: Double?): String`.

Beide Seiten rechnen in ganzen Cent bzw. Zehntelprozent (`Math.round` auf den Betrag ohne Vorzeichen, halbe Werte aufwärts — in JS und Java gleich), Tausenderpunkt, Dezimalkomma, `" €"` mit normalem Leerzeichen, Minus als U+2212 `−`.

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/portfolio/alert-texts.json`:
```json
{
  "_comment": "Spec G2 §8 — Treffertexte. desktop/electron/alert-text.test.cjs und AlertTextTest.kt lesen diese Datei.",
  "cases": [
    {
      "name": "Bewegung aufwärts",
      "event": { "kind": "move", "name": "Blauäugiger w. Drache", "card_id": "89631139", "set_code": "LOB-DE001", "rarity": "Ultra Rare", "old_price": 10, "new_price": 12, "pct": 20, "days": 7, "threshold": null },
      "text": "Blauäugiger w. Drache · LOB-DE001 · Ultra Rare: +20,0 % in 7 Tagen (10,00 € → 12,00 €)"
    },
    {
      "name": "Bewegung abwärts, 30 Tage, Tausenderpunkt",
      "event": { "kind": "move", "name": "Dunkler Magier", "card_id": "46986414", "set_code": "SDY-DE005", "rarity": "Common", "old_price": 1234.5, "new_price": 925.88, "pct": -25, "days": 30, "threshold": null },
      "text": "Dunkler Magier · SDY-DE005 · Common: −25,0 % in 30 Tagen (1.234,50 € → 925,88 €)"
    },
    {
      "name": "Rundung auf Zehntelprozent und große Beträge",
      "event": { "kind": "move", "name": "Kuriboh", "card_id": "40640057", "set_code": "MRD-DE071", "rarity": "Rare", "old_price": 932.2, "new_price": 1000000, "pct": 7.25, "days": 7, "threshold": null },
      "text": "Kuriboh · MRD-DE071 · Rare: +7,3 % in 7 Tagen (932,20 € → 1.000.000,00 €)"
    },
    {
      "name": "Zielpreis oben",
      "event": { "kind": "above", "name": "Exodia", "card_id": "33396948", "set_code": "LOB-DE124", "rarity": "Ultra Rare", "old_price": 45.5, "new_price": 50, "pct": null, "days": null, "threshold": 50 },
      "text": "Exodia · LOB-DE124 · Ultra Rare: Zielpreis ≥ 50,00 € erreicht (50,00 €)"
    },
    {
      "name": "Zielpreis unten ohne Namen, Unknown und leere Rarität",
      "event": { "kind": "below", "name": null, "card_id": "46986414", "set_code": "Unknown", "rarity": "", "old_price": null, "new_price": 4, "pct": null, "days": null, "threshold": 5 },
      "text": "46986414 · Unbekannt · Unbekannt: Zielpreis ≤ 5,00 € erreicht (4,00 €)"
    }
  ]
}
```

- [ ] **Step 2: JS-Test schreiben**

`desktop/electron/alert-text.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { alertText, eur, signedPct } = require('./alert-text.cjs');

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/AlertTextTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'alert-texts.json'), 'utf8'));

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.equal(alertText(c.event), c.text);
  });
}

test('Beträge und Prozent', () => {
  assert.equal(eur(0), '0,00 €');
  assert.equal(eur(-3.5), '−3,50 €');
  assert.equal(signedPct(0), '+0,0 %');
  assert.equal(signedPct(-12.34), '−12,3 %');
});
```

- [ ] **Step 3: Kotlin-Test schreiben**

`android/app/src/test/java/com/example/yugiohscanner/AlertTextTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.AlertText
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/electron/alert-text.test.cjs -- dieselbe Fixture docs/fixtures/portfolio/alert-texts.json. */
class AlertTextTest {
    @Test fun `alle Fixture-Faelle`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/portfolio/alert-texts.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val e = c.getJSONObject("event")
            fun dbl(k: String): Double? = if (e.isNull(k)) null else e.getDouble(k)
            val text = AlertText.of(
                kind = e.getString("kind"),
                name = if (e.isNull("name")) null else e.getString("name"),
                cardId = e.getString("card_id"),
                setCode = if (e.isNull("set_code")) null else e.getString("set_code"),
                rarity = if (e.isNull("rarity")) null else e.getString("rarity"),
                oldPrice = dbl("old_price"),
                newPrice = e.getDouble("new_price"),
                pct = dbl("pct"),
                days = if (e.isNull("days")) null else e.getInt("days"),
                threshold = dbl("threshold"),
            )
            assertEquals(c.getString("name"), c.getString("text"), text)
        }
    }

    @Test fun `Betraege und Prozent`() {
        assertEquals("0,00 €", AlertText.eur(0.0))
        assertEquals("−3,50 €", AlertText.eur(-3.5))
        assertEquals("+0,0 %", AlertText.signedPct(0.0))
        assertEquals("−12,3 %", AlertText.signedPct(-12.34))
    }
}
```

- [ ] **Step 4: Fehlschlag bestätigen**

Run: `node --test desktop/electron/alert-text.test.cjs` → FAIL (`Cannot find module './alert-text.cjs'`).
Den Kotlin-Fehlschlag (Kompilierfehler `Unresolved reference: AlertText`) nicht eigens bauen; er zeigt sich im Gradle-Lauf von Step 7, wenn Step 6 fehlt.

- [ ] **Step 5: `desktop/electron/alert-text.cjs` schreiben**

```js
// Spec G2 §8 — Treffertexte der Preis-Alarme (Windows-Benachrichtigung und Desktop-Liste).
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/AlertText.kt. Beide laufen gegen
// docs/fixtures/portfolio/alert-texts.json. Wer eine Seite aendert, aendert beide.
const MINUS = '\u2212';

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// "1.234,50 €" — in ganzen Cent gerechnet, damit Kotlin und JS gleich runden.
function eur(value) {
  const v = Number(value);
  const cents = Math.round(Math.abs(v) * 100);
  const int = String(Math.floor(cents / 100));
  const frac = String(cents % 100).padStart(2, '0');
  return `${v < 0 && cents > 0 ? MINUS : ''}${group(int)},${frac} €`;
}

// "+20,0 %" / "−25,0 %" — in Zehntelprozent gerechnet.
function signedPct(value) {
  const v = Number(value);
  const tenths = Math.round(Math.abs(v) * 10);
  return `${v < 0 ? MINUS : '+'}${Math.floor(tenths / 10)},${tenths % 10} %`;
}

// Gespeichertes "Unknown" oder leer erscheint als "Unbekannt" (Spec G1 §4.12).
const label = (v) => (v && String(v).trim() && v !== 'Unknown' ? v : 'Unbekannt');

function alertText(e) {
  const head = `${e.name || e.card_id} · ${label(e.set_code)} · ${label(e.rarity)}`;
  if (e.kind === 'move') {
    const old = e.old_price == null ? '—' : eur(e.old_price);
    return `${head}: ${signedPct(e.pct ?? 0)} in ${e.days} Tagen (${old} → ${eur(e.new_price)})`;
  }
  const op = e.kind === 'above' ? '≥' : '≤';
  return `${head}: Zielpreis ${op} ${eur(e.threshold ?? 0)} erreicht (${eur(e.new_price)})`;
}

module.exports = { alertText, eur, signedPct };
```

- [ ] **Step 6: `ml/AlertText.kt` schreiben**

```kotlin
package com.example.yugiohscanner.ml

import kotlin.math.abs

/**
 * Spec G2 §8 -- Treffertexte der Preis-Alarme.
 * ZWILLING: desktop/electron/alert-text.cjs. Beide laufen gegen docs/fixtures/portfolio/alert-texts.json.
 * Wer eine Seite aendert, aendert beide. Gerechnet wird in ganzen Cent bzw. Zehntelprozent.
 */
object AlertText {
    private const val MINUS = "\u2212"

    fun eur(value: Double): String {
        val cents = Math.round(abs(value) * 100)
        val int = (cents / 100).toString().reversed().chunked(3).joinToString(".").reversed()
        val frac = (cents % 100).toString().padStart(2, '0')
        return "${if (value < 0 && cents > 0) MINUS else ""}$int,$frac €"
    }

    fun signedPct(value: Double): String {
        val tenths = Math.round(abs(value) * 10)
        return "${if (value < 0) MINUS else "+"}${tenths / 10},${tenths % 10} %"
    }

    // Gespeichertes "Unknown" oder leer erscheint als "Unbekannt" (Spec G1 §4.12).
    private fun label(v: String?): String = if (v.isNullOrBlank() || v == "Unknown") "Unbekannt" else v

    fun of(
        kind: String, name: String?, cardId: String, setCode: String?, rarity: String?,
        oldPrice: Double?, newPrice: Double, pct: Double?, days: Int?, threshold: Double?,
    ): String {
        val head = "${name?.takeIf { it.isNotEmpty() } ?: cardId} · ${label(setCode)} · ${label(rarity)}"
        if (kind == "move") {
            val old = oldPrice?.let { eur(it) } ?: "—"
            return "$head: ${signedPct(pct ?: 0.0)} in $days Tagen ($old → ${eur(newPrice)})"
        }
        val op = if (kind == "above") "≥" else "≤"
        return "$head: Zielpreis $op ${eur(threshold ?: 0.0)} erreicht (${eur(newPrice)})"
    }
}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `node --test desktop/electron/alert-text.test.cjs` → PASS (6).
Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.AlertTextTest"` → PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/fixtures/portfolio/alert-texts.json desktop/electron/alert-text.cjs desktop/electron/alert-text.test.cjs android/app/src/main/java/com/example/yugiohscanner/ml/AlertText.kt android/app/src/test/java/com/example/yugiohscanner/AlertTextTest.kt
git commit -m "feat(g2): Treffertexte der Preis-Alarme als JS/Kotlin-Zwilling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Desktop-Hauptprozess (Benachrichtigung, Sync-Schritt, IPC)

**Files:**
- Create: `desktop/electron/alert-notify.cjs`
- Create: `desktop/electron/alert-notify.test.cjs`
- Modify: `desktop/electron/sync.cjs` (Import oben; `startSync`-Signatur Zeile 185; neuer Schritt vor `cycle()`; Aufruf in `cycle()` nach `syncSnapshot`)
- Modify: `desktop/electron/main.cjs` (Import nach Zeile 17; `whenReady` Zeilen 103–110; neuer Block nach `open-external`, Zeile 263)
- Modify: `desktop/electron/preload.cjs` (nach dem Deals-Block, vor `});` am Ende)

**Interfaces:**
- Consumes (Task 4): `alertText(e)` aus `./alert-text.cjs`.
- Produces (für Task 6/7, Renderer über `window.api`):
  - `getPriceAlertMove()` → `{ id, pct, min_eur, days, active } | null`
  - `savePriceAlertMove({ pct, min_eur, days, active })` → `true`
  - `getPriceAlertTargets({ id, set_code, language, rarity })` → `{ above: { threshold: number, armed: boolean } | null, below: … }`
  - `savePriceAlertTarget({ printing, kind: 'above'|'below', threshold: number|null })` → `true` (`null` = entfernen)
  - `listPriceAlertEvents()` → Treffer-Zeilen (`id, kind, card_id, set_code, language, rarity, old_price, new_price, pct, days, threshold, day, dismissed, …`) **plus** `name` (lokal, oder null) und `text` (fertiger Treffertext), neueste zuerst, max. 200
  - `dismissPriceAlertEvent(id)`, `dismissAllPriceAlertEvents()` → `true`
  - `onPriceAlertsChanged(cb)` → Abmeldefunktion; feuert nach eigenem „Erledigt" und wenn der Sync-Zyklus eine geänderte Menge offener Treffer sieht
  - `onOpenPriceAlerts(cb)` → Abmeldefunktion; feuert beim Klick auf die Windows-Benachrichtigung
  - Fehlertext ohne Cloud: `Cloud nicht verbunden`

- [ ] **Step 1: Test für `nextNotification` schreiben**

`desktop/electron/alert-notify.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { nextNotification, openSignature } = require('./alert-notify.cjs');

const ev = (...ids) => ids.map((id) => ({ id }));

test('erster Lauf ist still und setzt die Marke auf die größte id', () => {
  assert.deepStrictEqual(nextNotification(ev(5, 3), null), { notify: 'none', event: null, count: 0, marker: 5 });
  assert.deepStrictEqual(nextNotification(ev(5, 3), ''), { notify: 'none', event: null, count: 0, marker: 5 });
});

test('erster Lauf ohne Treffer setzt die Marke auf 0, der nächste Treffer wird gemeldet', () => {
  assert.deepStrictEqual(nextNotification([], null), { notify: 'none', event: null, count: 0, marker: 0 });
  const r = nextNotification(ev(1), '0');
  assert.equal(r.notify, 'one');
  assert.equal(r.event.id, 1);
  assert.equal(r.marker, 1);
});

test('ein neuer Treffer', () => {
  const r = nextNotification(ev(7, 5), '5');
  assert.deepStrictEqual(r, { notify: 'one', event: { id: 7 }, count: 1, marker: 7 });
});

test('mehrere neue Treffer', () => {
  assert.deepStrictEqual(nextNotification(ev(9, 8, 5), '5'), { notify: 'many', event: null, count: 2, marker: 9 });
});

test('Marke läuft nur vorwärts', () => {
  assert.deepStrictEqual(nextNotification(ev(3), '8'), { notify: 'none', event: null, count: 0, marker: 8 });
  assert.deepStrictEqual(nextNotification([], '8'), { notify: 'none', event: null, count: 0, marker: 8 });
});

test('Signatur ändert sich mit der Menge offener Treffer', () => {
  assert.equal(openSignature(ev(9, 8)), openSignature(ev(9, 8)));
  assert.notEqual(openSignature(ev(9, 8)), openSignature(ev(9)));
  assert.equal(openSignature([]), '');
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node --test desktop/electron/alert-notify.test.cjs`
Expected: FAIL — `Cannot find module './alert-notify.cjs'`.

- [ ] **Step 3: `desktop/electron/alert-notify.cjs` schreiben**

```js
// Spec G2 §6.2 — ob und wie der Desktop neue Preis-Alarme meldet. Reiner Helfer (alert-notify.test.cjs).
// `events` sind die offenen Treffer aus der Cloud, `marker` ist das Setting price_alerts_notified_until
// (Text oder null). Der erste Lauf meldet nichts, damit ein neu eingerichteter Desktop nicht alle
// alten Treffer auf einmal ausspielt. Die Marke laeuft nur vorwaerts.
function nextNotification(events, marker) {
  const list = (events || []).filter((e) => Number.isFinite(Number(e.id)));
  const maxId = list.reduce((m, e) => Math.max(m, Number(e.id)), 0);
  const m = marker == null || marker === '' || !Number.isFinite(Number(marker)) ? null : Number(marker);
  if (m == null) return { notify: 'none', event: null, count: 0, marker: maxId };
  const fresh = list.filter((e) => Number(e.id) > m).sort((a, b) => Number(b.id) - Number(a.id));
  const next = Math.max(m, maxId);
  if (fresh.length === 0) return { notify: 'none', event: null, count: 0, marker: next };
  if (fresh.length === 1) return { notify: 'one', event: fresh[0], count: 1, marker: next };
  return { notify: 'many', event: null, count: fresh.length, marker: next };
}

// Aendert sich, sobald ein Treffer dazukommt oder (auch am Handy) erledigt wird.
const openSignature = (events) => (events || []).map((e) => e.id).join(',');

module.exports = { nextNotification, openSignature };
```

- [ ] **Step 4: Test grün**

Run: `node --test desktop/electron/alert-notify.test.cjs` → PASS (6).

- [ ] **Step 5: Sync-Schritt in `sync.cjs`**

Import nach Zeile 4 (`const { mergeRemotePriceHistory } = require('./price-history.cjs');`):
```js
const { nextNotification, openSignature } = require('./alert-notify.cjs');
```

Signatur Zeile 185 ersetzen:
```js
function startSync(db, getWindow, { onPriceAlerts } = {}) {
  let client = null;
  let running = false;
  let lastAlertSignature = null;
```
(die beiden bestehenden Zeilen `let client = null;` / `let running = false;` bleiben dabei nur einmal stehen.)

Neue Funktion direkt vor `async function cycle() {`:
```js
  // Spec G2 §6.2: die Cloud wertet Preis-Alarme aus, der Desktop liest nur. Neue Treffer meldet
  // onPriceAlerts (Windows-Benachrichtigung in main.cjs); eine geaenderte Menge offener Treffer
  // (neu oder anderswo erledigt) bekommt der Renderer als price-alerts-changed. Nie fatal fuer den
  // Zyklus — die Tabelle kann noch fehlen.
  async function syncPriceAlerts(c) {
    try {
      const { data, error } = await c.from('price_alert_events').select('*')
        .eq('dismissed', false).order('id', { ascending: false }).limit(200);
      if (error) return;
      const events = data || [];
      const before = getSetting(db, 'price_alerts_notified_until');
      const r = nextNotification(events, before);
      // Marke vor dem Melden speichern: scheitert die Benachrichtigung, kommt sie nicht jede 20 s wieder.
      if (String(r.marker) !== before) setSetting(db, 'price_alerts_notified_until', r.marker);
      if (r.notify !== 'none' && onPriceAlerts) onPriceAlerts(r);
      const sig = openSignature(events);
      if (sig !== lastAlertSignature) {
        lastAlertSignature = sig;
        const w = getWindow();
        if (w) w.webContents.send('price-alerts-changed');
      }
    } catch (e) {
      console.error('[sync] price alerts:', e.message);
    }
  }
```

In `cycle()` nach `await syncSnapshot(c);`:
```js
      await syncPriceAlerts(c);
```

- [ ] **Step 6: `main.cjs` — Import, App-ID, Sync-Hook**

Nach Zeile 17 (`const { totalValue, copyCount } = require('./valuation.cjs');`):
```js
const { alertText } = require('./alert-text.cjs');
```

In `app.whenReady().then(() => {` als erste Zeile vor `createWindow();`:
```js
  // Windows zeigt Benachrichtigungen nur mit App-ID (gleich appId in package.json).
  if (process.platform === 'win32') app.setAppUserModelId('com.yugioh.cardmanager');
```
und Zeile `sync = startSync(db, () => mainWindow);` ersetzen durch:
```js
  sync = startSync(db, () => mainWindow, { onPriceAlerts: showPriceAlertNotification });
```

- [ ] **Step 7: `main.cjs` — Preis-Alarm-Block**

Direkt nach `ipcMain.handle('open-external', (event, url) => { if (url) shell.openExternal(url); });` einfügen:
```js
// --- Spec G2: Preis-Alarme (Supabase; ausgewertet nur von der Edge Function evaluate-price-alerts) ---
async function alertsClient() {
    const c = sync && await sync.ensureClient();
    if (!c) throw new Error('Cloud nicht verbunden');
    return c;
}
const alertPrinting = (p = {}) => ({
    card_id: String(p.id), set_code: p.set_code || 'Unknown', language: p.language || 'DE', rarity: p.rarity || 'Unknown',
});
function cardNameOf(cardId) {
    try { return db.prepare('SELECT name FROM cards WHERE id = ? AND name IS NOT NULL LIMIT 1').get(String(cardId))?.name || null; }
    catch { return null; }
}
function withAlertText(e) {
    const name = cardNameOf(e.card_id);
    return { ...e, name, text: alertText({ ...e, name }) };
}
function notifyPriceAlertsChanged() {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('price-alerts-changed');
}
// Referenz halten, sonst raeumt der GC die Notification weg und der Klick kommt nie an.
const liveNotifications = new Set();
function showPriceAlertNotification(r) {
    if (!Notification.isSupported()) return;
    const body = r.notify === 'one' ? withAlertText(r.event).text : `${r.count} neue Preis-Alarme`;
    const n = new Notification({ title: 'Preis-Alarm', body });
    liveNotifications.add(n);
    const drop = () => liveNotifications.delete(n);
    n.on('click', () => {
        drop();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('open-price-alerts');
    });
    n.on('close', drop);
    n.show();
}
ipcMain.handle('price-alerts-move-get', async () => {
    const c = await alertsClient();
    const { data, error } = await c.from('price_alert_rules').select('id,pct,min_eur,days,active')
        .eq('kind', 'move').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { ...data, pct: Number(data.pct), min_eur: Number(data.min_eur), days: Number(data.days) } : null;
});
// Ohne Zeile ist der Bewegungsalarm aus (Spec §4.1); speichern legt sie an oder aktualisiert sie.
ipcMain.handle('price-alerts-move-save', async (event, { pct, min_eur, days, active } = {}) => {
    const c = await alertsClient();
    const row = { pct: Number(pct), min_eur: Number(min_eur), days: Number(days) === 30 ? 30 : 7, active: !!active };
    const { data: cur, error: readError } = await c.from('price_alert_rules').select('id').eq('kind', 'move').maybeSingle();
    if (readError) throw new Error(readError.message);
    const { error } = cur
        ? await c.from('price_alert_rules').update(row).eq('id', cur.id)
        : await c.from('price_alert_rules').insert({ kind: 'move', ...row });
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('price-alerts-targets-get', async (event, printing) => {
    const c = await alertsClient();
    const { data, error } = await c.from('price_alert_rules').select('kind,threshold,armed')
        .in('kind', ['above', 'below']).eq('active', true).match(alertPrinting(printing));
    if (error) throw new Error(error.message);
    const pick = (kind) => {
        const r = (data || []).find((x) => x.kind === kind);
        return r ? { threshold: Number(r.threshold), armed: !!r.armed } : null;
    };
    return { above: pick('above'), below: pick('below') };
});
// threshold null = entfernen (active = false, Treffer bleiben). Setzen macht den Zielpreis wieder scharf.
ipcMain.handle('price-alerts-target-save', async (event, { printing, kind, threshold } = {}) => {
    if (kind !== 'above' && kind !== 'below') throw new Error('Unbekannte Alarmart');
    const c = await alertsClient();
    const key = alertPrinting(printing);
    const value = threshold == null || threshold === '' ? null : Number(threshold);
    const { error } = value == null
        ? await c.from('price_alert_rules').update({ active: false }).eq('kind', kind).match(key)
        : await c.from('price_alert_rules').upsert(
            { kind, ...key, threshold: value, active: true, armed: true },
            { onConflict: 'user_id,kind,card_id,set_code,language,rarity' },
        );
    if (error) throw new Error(error.message);
    return true;
});
ipcMain.handle('price-alerts-events-list', async () => {
    const c = await alertsClient();
    const { data, error } = await c.from('price_alert_events').select('*')
        .eq('dismissed', false).order('id', { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return (data || []).map(withAlertText);
});
ipcMain.handle('price-alerts-event-dismiss', async (event, id) => {
    const c = await alertsClient();
    const { error } = await c.from('price_alert_events').update({ dismissed: true }).eq('id', id);
    if (error) throw new Error(error.message);
    notifyPriceAlertsChanged();
    return true;
});
ipcMain.handle('price-alerts-events-dismiss-all', async () => {
    const c = await alertsClient();
    const { error } = await c.from('price_alert_events').update({ dismissed: true }).eq('dismissed', false);
    if (error) throw new Error(error.message);
    notifyPriceAlertsChanged();
    return true;
});
```

- [ ] **Step 8: `preload.cjs`**

Nach der Zeile `onDealWatchesChanged: …,` (vor dem schließenden `});`):
```js

  // Preis-Alarme (Spec G2) — ausgewertet in der Cloud, hier nur lesen/pflegen
  getPriceAlertMove: () => ipcRenderer.invoke('price-alerts-move-get'),
  savePriceAlertMove: (data) => ipcRenderer.invoke('price-alerts-move-save', data),
  getPriceAlertTargets: (printing) => ipcRenderer.invoke('price-alerts-targets-get', printing),
  savePriceAlertTarget: (data) => ipcRenderer.invoke('price-alerts-target-save', data),
  listPriceAlertEvents: () => ipcRenderer.invoke('price-alerts-events-list'),
  dismissPriceAlertEvent: (id) => ipcRenderer.invoke('price-alerts-event-dismiss', id),
  dismissAllPriceAlertEvents: () => ipcRenderer.invoke('price-alerts-events-dismiss-all'),
  onPriceAlertsChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('price-alerts-changed', s); return () => ipcRenderer.removeListener('price-alerts-changed', s); },
  onOpenPriceAlerts: (cb) => { const s = (_e) => cb(); ipcRenderer.on('open-price-alerts', s); return () => ipcRenderer.removeListener('open-price-alerts', s); },
```

- [ ] **Step 9: Prüfen**

1. `node --check desktop/electron/main.cjs && node --check desktop/electron/sync.cjs && node --check desktop/electron/preload.cjs` → keine Ausgabe.
2. Kanal-Parität: für jeden der Namen `price-alerts-move-get price-alerts-move-save price-alerts-targets-get price-alerts-target-save price-alerts-events-list price-alerts-event-dismiss price-alerts-events-dismiss-all price-alerts-changed open-price-alerts` per Grep bestätigen, dass er in `main.cjs` (bzw. für die beiden Ereignisse in `main.cjs` oder `sync.cjs`) UND in `preload.cjs` vorkommt.
3. `node --test desktop/electron/alert-notify.test.cjs desktop/electron/alert-text.test.cjs` → PASS.
4. In `desktop/`: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün (G1-Stand 115 + 12 neue).
5. In `desktop/`: `npx eslint .` → genau `5 errors`.

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/alert-notify.cjs desktop/electron/alert-notify.test.cjs desktop/electron/sync.cjs desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(g2): Desktop liest Preis-Alarme, meldet neue Treffer und pflegt Regeln

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Desktop-Renderer — Alarmliste, Start-Karte, Insights-Reiter, Navigation, Deals-Titel

**Files:**
- Create: `desktop/src/utils/usePriceAlertEvents.js`
- Create: `desktop/src/components/PriceAlertsList.jsx`
- Create: `desktop/src/components/PriceAlertsCard.jsx`
- Create: `desktop/src/components/PriceAlertsPanel.jsx`
- Modify: `desktop/src/components/Start.jsx` (Import Zeile 6, Einbau vor `<MoversCard />` Zeile 189)
- Modify: `desktop/src/components/Insights.jsx` (ganze Datei, siehe unten)
- Modify: `desktop/src/App.jsx` (Import, neuer Effekt nach dem Scan-/Fortschritts-Effekt Zeile 72)
- Modify: `desktop/src/components/Deals.jsx:69` (Titel)

**Interfaces:**
- Consumes (Task 5): `window.api.listPriceAlertEvents`, `dismissPriceAlertEvent`, `dismissAllPriceAlertEvents`, `onPriceAlertsChanged`, `onOpenPriceAlerts`; Treffer tragen `text`.
- Consumes (vorhanden): `cardRoute` und `ROUTES` aus `src/utils/routes.js`, `fmtDayDE` aus `src/utils/priceSteps.js`, `MoversSkeleton` aus `MoversList.jsx`.
- Produces: `usePriceAlertEvents()` → `{ loading, error, events }` (`events` null bis zum ersten Erfolg); Insights-Reiter-ID `alarme` (Navigation mit `state: { tab: 'alarme' }`).

Keine Renderer-Tests im Projekt für Komponenten; Prüfung per Lint und Build. Die Regel „kein synchrones setState im Effekt" (`react-hooks/set-state-in-effect`) gilt: setState nur in Promise-Callbacks oder Event-Handlern, Anfangszustand per Lazy-Init.

- [ ] **Step 1: `src/utils/usePriceAlertEvents.js`**

```js
import { useState, useEffect } from 'react';

const LOAD_ERROR = 'Preis-Alarme konnten nicht geladen werden.';

// Spec G2 §6.3 — offene Preis-Alarme. Laedt neu, wenn der Hauptprozess price-alerts-changed meldet
// (Sync-Zyklus oder ein eigenes "Erledigt"). Bei einem Fehler bleibt der letzte Stand stehen.
export function usePriceAlertEvents() {
  const [state, setState] = useState(() => (window.api?.listPriceAlertEvents
    ? { loading: true, error: null, events: null }
    : { loading: false, error: LOAD_ERROR, events: null }));
  useEffect(() => {
    if (!window.api?.listPriceAlertEvents) return undefined;
    let alive = true;
    const load = () => window.api.listPriceAlertEvents()
      .then((events) => { if (alive) setState({ loading: false, error: null, events: events || [] }); })
      .catch(() => { if (alive) setState((s) => ({ loading: false, error: LOAD_ERROR, events: s.events })); });
    load();
    const off = window.api.onPriceAlertsChanged?.(() => load());
    return () => { alive = false; off?.(); };
  }, []);
  return state;
}
```

- [ ] **Step 2: `src/components/PriceAlertsList.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { cardRoute } from '../utils/routes';
import { fmtDayDE } from '../utils/priceSteps';

// Spec G2 §6.3 — Zeilen offener Preis-Alarme (Start-Karte und Insights-Reiter). Der Text kommt fertig
// aus dem Hauptprozess (electron/alert-text.cjs), damit es nur eine JS-Fassung gibt.
const printingOf = (e) => ({ id: e.card_id, set_code: e.set_code, language: e.language, rarity: e.rarity });

export default function PriceAlertsList({ events }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [failed, setFailed] = useState(false);
  const list = events.map((e) => cardRoute(printingOf(e)));
  const dismiss = (id) => window.api.dismissPriceAlertEvent(id)
    .then(() => setFailed(false))
    .catch(() => setFailed(true));
  return (
    <div>
      {failed && <div className="text-[11px] text-crit mb-1">Erledigen fehlgeschlagen.</div>}
      <div className="divide-y divide-line">
        {events.map((e) => (
          <div key={e.id} className="flex items-center gap-3 py-2">
            <button type="button"
              onClick={() => navigate(cardRoute(printingOf(e)), { state: { background: location, list } })}
              className="min-w-0 flex-1 flex items-center gap-3 text-left hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
              <span className="font-mono text-[11px] text-ink-faint shrink-0">{fmtDayDE(String(e.day))}</span>
              <span className="text-sm text-ink truncate">{e.text}</span>
            </button>
            <button type="button" onClick={() => dismiss(e.id)}
              className="shrink-0 flex items-center gap-1 text-xs text-ink-muted hover:text-ink border border-line rounded-lg px-2 py-1">
              <Check className="w-3 h-3" /> Erledigt
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `src/components/PriceAlertsCard.jsx`**

```jsx
import { useNavigate } from 'react-router-dom';
import { BellRing, ArrowRight } from 'lucide-react';
import PriceAlertsList from './PriceAlertsList';
import { usePriceAlertEvents } from '../utils/usePriceAlertEvents';
import { ROUTES } from '../utils/routes';

// Spec G2 §6.3 — Start-Karte "Preis-Alarme (N)", nur bei bekannten offenen Treffern. Laden oder Fehler
// zeigen hier nichts; der Insights-Reiter "Alarme" zeigt beides ausdruecklich.
export default function PriceAlertsCard() {
  const navigate = useNavigate();
  const { events } = usePriceAlertEvents();
  if (!events || events.length === 0) return null;
  return (
    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-ink-muted flex items-center gap-2">
          <BellRing className="w-4 h-4" strokeWidth={1.8} /> Preis-Alarme ({events.length})
        </h3>
        <button onClick={() => navigate(ROUTES.insights, { state: { tab: 'alarme' } })}
          className="text-xs text-violet-soft hover:underline flex items-center gap-1">Alle <ArrowRight className="w-3 h-3" /></button>
      </div>
      <PriceAlertsList events={events.slice(0, 2)} />
    </div>
  );
}
```

- [ ] **Step 4: `src/components/PriceAlertsPanel.jsx`**

```jsx
import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import PriceAlertsList from './PriceAlertsList';
import { MoversSkeleton } from './MoversList';
import { usePriceAlertEvents } from '../utils/usePriceAlertEvents';

// Spec G2 §6.3 — Insights-Reiter "Alarme": alle offenen Treffer, oben "Alle erledigt".
export default function PriceAlertsPanel() {
  const { loading, error, events } = usePriceAlertEvents();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dismissAll = () => {
    setBusy(true);
    window.api.dismissAllPriceAlertEvents()
      .then(() => setFailed(false))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-ink-muted">Preis-Alarme</h3>
        {events && events.length > 0 && (
          <button onClick={dismissAll} disabled={busy}
            className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink border border-line rounded-lg px-2 py-1 disabled:opacity-50">
            <CheckCheck className="w-3 h-3" /> Alle erledigt
          </button>
        )}
      </div>
      {failed && <div className="text-[11px] text-crit mb-2">Erledigen fehlgeschlagen.</div>}
      {!events && loading && <MoversSkeleton rows={4} />}
      {!events && !loading && error && <div className="text-sm text-crit">{error}</div>}
      {events && error && <div className="text-[11px] text-ink-faint mb-2">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
      {events && events.length === 0 && <div className="text-sm text-ink-faint">Keine offenen Preis-Alarme</div>}
      {events && events.length > 0 && <PriceAlertsList events={events} />}
    </div>
  );
}
```

- [ ] **Step 5: `Insights.jsx` ersetzen**

```jsx
import { useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { TrendingUp, BarChart3, ArrowUpDown, BellRing, Loader2 } from 'lucide-react';
import Statistics from './Statistics';
import MoversPanel from './MoversPanel';
import ValueBreakdown from './ValueBreakdown';
import PriceAlertsPanel from './PriceAlertsPanel';

const Portfolio = lazy(() => import('./Portfolio'));

const Tab = ({ id, icon, label, view, setView }) => {
  const Icon = icon;
  return (
    <button
      onClick={() => setView(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-display text-sm font-medium transition-colors ${
        view === id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={1.8} /> {label}
    </button>
  );
};

export default function Insights() {
  const location = useLocation();
  // Spec G2 §6.2: der Klick auf die Benachrichtigung navigiert mit state.tab = 'alarme', auch wenn
  // Insights schon offen ist. Eine Reiterwahl gilt deshalb nur fuer den Navigationseintrag, auf dem
  // sie getroffen wurde (location.key) — ein neuer Eintrag nimmt wieder seinen state.tab, ohne setState
  // im Effekt.
  const requested = location.state?.tab || 'value';
  const [pick, setPick] = useState({ key: location.key, view: requested });
  const view = pick.key === location.key ? pick.view : requested;
  const setView = (v) => setPick({ key: location.key, view: v });
  const [metric, setMetric] = useState('count');

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <div className="inline-flex self-start bg-obsidian-700 border border-line rounded-xl p-1 gap-1 mb-5">
        <Tab id="value" icon={TrendingUp} label="Wert" view={view} setView={setView} />
        <Tab id="bewegungen" icon={ArrowUpDown} label="Bewegungen" view={view} setView={setView} />
        <Tab id="breakdown" icon={BarChart3} label="Aufteilung" view={view} setView={setView} />
        <Tab id="alarme" icon={BellRing} label="Alarme" view={view} setView={setView} />
      </div>
      <div className="flex-1 overflow-auto">
        {view === 'value' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
            <Portfolio />
          </Suspense>
        )}
        {view === 'bewegungen' && <MoversPanel />}
        {view === 'breakdown' && (
          <div className="space-y-4">
            <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
              {[{ id: 'count', label: 'Anzahl' }, { id: 'value', label: 'Wert' }].map((m) => (
                <button key={m.id} onClick={() => setMetric(m.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm ${metric === m.id ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>{m.label}</button>
              ))}
            </div>
            {metric === 'count' ? <Statistics /> : <ValueBreakdown />}
          </div>
        )}
        {view === 'alarme' && <PriceAlertsPanel />}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `Start.jsx`**

Nach Zeile 6 (`import MoversCard from './MoversCard';`):
```jsx
import PriceAlertsCard from './PriceAlertsCard';
```
Den Block
```jsx
      {/* Spec G1: Bewegungen */}
      <MoversCard />
```
ersetzen durch:
```jsx
      {/* Spec G2: Preis-Alarme direkt über den Bewegungen, nur bei offenen Treffern */}
      <PriceAlertsCard />

      {/* Spec G1: Bewegungen */}
      <MoversCard />
```

- [ ] **Step 7: `App.jsx` — Klick auf die Benachrichtigung**

Import nach Zeile 17 (`import { applyScan } from './utils/scanAggregate.js';`):
```jsx
import { ROUTES } from './utils/routes';
```
Nach dem Effekt, der mit `  }, []);` in Zeile 72 endet:
```jsx

  // Spec G2 §6.2: Klick auf die Windows-Benachrichtigung -> Insights, Reiter „Alarme".
  useEffect(() => window.api?.onOpenPriceAlerts?.(() => navigate(ROUTES.insights, { state: { tab: 'alarme' } })), [navigate]);
```

- [ ] **Step 8: `Deals.jsx:69`**

```jsx
        <h2 className="font-display text-xl font-bold text-ink flex-1">Deals</h2>
```
Danach per Grep bestätigen, dass `Preis-Alert` in `desktop/src` nicht mehr vorkommt.

- [ ] **Step 9: Prüfen**

In `desktop/`:
1. `npx eslint .` → genau `5 errors` (kein neuer Fehler in den neuen/geänderten Dateien).
2. `npx vite build` → erfolgreich.
3. `node --test src/utils/*.test.js src/utils/*.test.mjs` → unverändert grün.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/utils/usePriceAlertEvents.js desktop/src/components/PriceAlertsList.jsx desktop/src/components/PriceAlertsCard.jsx desktop/src/components/PriceAlertsPanel.jsx desktop/src/components/Insights.jsx desktop/src/components/Start.jsx desktop/src/App.jsx desktop/src/components/Deals.jsx
git commit -m "feat(g2): Preis-Alarme auf Start und als Insights-Reiter am Desktop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Desktop-Eingaben — Eingabeprüfung, Karten-Panel-Zeile, Einstellungen

**Files:**
- Create: `docs/fixtures/portfolio/alert-input.json`
- Create: `desktop/src/utils/alertInput.js`
- Create: `desktop/src/utils/alertInput.test.js`
- Create: `desktop/src/components/PriceAlertTargets.jsx`
- Create: `desktop/src/components/PriceAlertSettings.jsx`
- Modify: `desktop/src/components/CardDetailPanel.jsx` (Import nach Zeile 7; Einbau nach `<PriceHistoryChart … />`, Zeile 276)
- Modify: `desktop/src/components/Settings.jsx` (Import nach Zeile 5; Einbau am Ende des `space-y-6`-Blocks im Abschnitt `preise`)

**Interfaces:**
- Consumes (Task 5): `window.api.getPriceAlertTargets`, `savePriceAlertTarget`, `getPriceAlertMove`, `savePriceAlertMove`.
- Produces: `parseTarget(text)`, `parsePct(text)`, `parseMinEur(text)` → `{ value: number|null, error: string|null }` (`parseTarget('')` → `{ value: null, error: null }` = entfernen); `toInput(v)` → string. Kotlin-Zwilling in Task 8 gegen dieselbe Fixture.

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/portfolio/alert-input.json`:
```json
{
  "_comment": "Spec G2 §7/§9 — Eingabepruefung. desktop/src/utils/alertInput.test.js und AlertInputTest.kt lesen diese Datei. value null + error null = leer.",
  "target": [
    { "in": "", "value": null, "error": null },
    { "in": "   ", "value": null, "error": null },
    { "in": "12,5", "value": 12.5, "error": null },
    { "in": " 12.50 ", "value": 12.5, "error": null },
    { "in": "0", "value": null, "error": "Betrag muss größer als 0 sein" },
    { "in": "0,00", "value": null, "error": "Betrag muss größer als 0 sein" },
    { "in": "1.234,50", "value": null, "error": "Ungültiger Betrag" },
    { "in": "3,555", "value": null, "error": "Ungültiger Betrag" },
    { "in": "-3", "value": null, "error": "Ungültiger Betrag" },
    { "in": "abc", "value": null, "error": "Ungültiger Betrag" }
  ],
  "pct": [
    { "in": "20", "value": 20, "error": null },
    { "in": "12,5", "value": 12.5, "error": null },
    { "in": "500", "value": 500, "error": null },
    { "in": "1", "value": 1, "error": null },
    { "in": "0", "value": null, "error": "Prozent zwischen 1 und 500" },
    { "in": "501", "value": null, "error": "Prozent zwischen 1 und 500" },
    { "in": "", "value": null, "error": "Ungültige Zahl" },
    { "in": "1,25", "value": null, "error": "Ungültige Zahl" }
  ],
  "minEur": [
    { "in": "2", "value": 2, "error": null },
    { "in": "0", "value": 0, "error": null },
    { "in": "1,5", "value": 1.5, "error": null },
    { "in": "", "value": null, "error": "Ungültiger Betrag" },
    { "in": "-1", "value": null, "error": "Ungültiger Betrag" }
  ],
  "toInput": [
    { "in": 12.5, "out": "12,5" },
    { "in": 2, "out": "2" },
    { "in": 0.99, "out": "0,99" },
    { "in": null, "out": "" }
  ]
}
```

- [ ] **Step 2: JS-Test schreiben**

`desktop/src/utils/alertInput.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTarget, parsePct, parseMinEur, toInput } from './alertInput.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/AlertInputTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/portfolio/alert-input.json', import.meta.url), 'utf8'));

const check = (fn, cases) => {
  for (const c of cases) assert.deepEqual(fn(c.in), { value: c.value, error: c.error }, JSON.stringify(c.in));
};

test('Zielpreis', () => check(parseTarget, FIX.target));
test('Prozent', () => check(parsePct, FIX.pct));
test('Mindestbetrag', () => check(parseMinEur, FIX.minEur));
test('Anzeige im Feld', () => {
  for (const c of FIX.toInput) assert.equal(toInput(c.in), c.out);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

In `desktop/`: `node --test src/utils/alertInput.test.js` → FAIL (Modul nicht gefunden).

- [ ] **Step 4: `desktop/src/utils/alertInput.js`**

```js
// Spec G2 §7/§9 — Eingabepruefung der Preis-Alarme (deutsches Komma, kein Tausenderpunkt).
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/AlertInput.kt. Beide laufen gegen
// docs/fixtures/portfolio/alert-input.json. Wer eine Seite aendert, aendert beide.
const EURO = /^\d+([.,]\d{1,2})?$/;
const PCT = /^\d+([.,]\d)?$/;
const num = (t) => Number(t.replace(',', '.'));
const clean = (text) => String(text ?? '').trim();

// Zielpreis: leer heisst entfernen ({ value: null, error: null }).
export function parseTarget(text) {
  const t = clean(text);
  if (t === '') return { value: null, error: null };
  if (!EURO.test(t)) return { value: null, error: 'Ungültiger Betrag' };
  const v = num(t);
  return v > 0 ? { value: v, error: null } : { value: null, error: 'Betrag muss größer als 0 sein' };
}

export function parsePct(text) {
  const t = clean(text);
  if (!PCT.test(t)) return { value: null, error: 'Ungültige Zahl' };
  const v = num(t);
  return v >= 1 && v <= 500 ? { value: v, error: null } : { value: null, error: 'Prozent zwischen 1 und 500' };
}

export function parseMinEur(text) {
  const t = clean(text);
  if (!EURO.test(t)) return { value: null, error: 'Ungültiger Betrag' };
  return { value: num(t), error: null };
}

// Gespeicherter Betrag im Eingabefeld: 12.5 -> "12,5", 2 -> "2", null -> "".
export const toInput = (v) => (v == null ? '' : String(Number(v)).replace('.', ','));
```

- [ ] **Step 5: Test grün**

In `desktop/`: `node --test src/utils/alertInput.test.js` → PASS (4).

- [ ] **Step 6: `src/components/PriceAlertTargets.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { parseTarget, toInput } from '../utils/alertInput';

const errorText = (e) => (String(e?.message || '').includes('Cloud nicht verbunden') ? 'Cloud nicht verbunden' : 'nicht verfügbar');

// Spec G2 §6.3 — "Preis-Alarm: ≥ [ ] € · ≤ [ ] €" unter dem Preisverlauf eines Printings. Gespeichert wird
// beim Verlassen des Felds oder mit Enter, und nur bei geaendertem Wert: jedes Speichern macht den
// Zielpreis wieder scharf (Spec §4.1) und darf nicht nebenbei passieren. Leer = entfernen.
export default function PriceAlertTargets({ printing }) {
  const { id, set_code: setCode, language, rarity } = printing;
  const [state, setState] = useState(() => (window.api?.getPriceAlertTargets
    ? { error: null, targets: null }
    : { error: 'nicht verfügbar', targets: null }));
  const [text, setText] = useState({ above: '', below: '' });
  const [fieldError, setFieldError] = useState({ above: null, below: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!window.api?.getPriceAlertTargets) return undefined;
    let alive = true;
    window.api.getPriceAlertTargets({ id, set_code: setCode, language, rarity })
      .then((targets) => {
        if (!alive) return;
        setState({ error: null, targets });
        setText({ above: toInput(targets.above?.threshold), below: toInput(targets.below?.threshold) });
      })
      .catch((e) => { if (alive) setState((s) => ({ error: errorText(e), targets: s.targets })); });
    return () => { alive = false; };
  }, [id, setCode, language, rarity, tick]);

  const save = async (kind) => {
    const parsed = parseTarget(text[kind]);
    setFieldError((f) => ({ ...f, [kind]: parsed.error }));
    if (parsed.error) return;
    const current = state.targets?.[kind]?.threshold ?? null;
    if (parsed.value === current) return;
    try {
      await window.api.savePriceAlertTarget({ printing: { id, set_code: setCode, language, rarity }, kind, threshold: parsed.value });
      setTick((t) => t + 1);
    } catch {
      setFieldError((f) => ({ ...f, [kind]: 'Speichern fehlgeschlagen' }));
    }
  };

  if (!state.targets) {
    return state.error
      ? <div className="text-[11px] text-ink-faint py-1">Preis-Alarm: {state.error}</div>
      : <div className="h-7" aria-hidden="true" />;
  }

  const field = (kind, sign) => (
    <span className="flex items-center gap-1">
      <span className="text-ink-muted">{sign}</span>
      <input value={text[kind]} inputMode="decimal" aria-label={`Preis-Alarm ${sign}`}
        onChange={(e) => setText((t) => ({ ...t, [kind]: e.target.value }))}
        onBlur={() => save(kind)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={`w-16 bg-black/40 border rounded px-1 py-0.5 text-xs text-white font-mono ${fieldError[kind] ? 'border-crit' : 'border-gray-700'}`} />
      <span className="text-ink-muted">€</span>
      {state.targets[kind] && !state.targets[kind].armed && <span className="text-[10px] text-gold">ausgelöst</span>}
    </span>
  );

  return (
    <div className="py-1 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-ink-muted">Preis-Alarm:</span>
        {field('above', '≥')}
        <span className="text-ink-faint">·</span>
        {field('below', '≤')}
      </div>
      {(fieldError.above || fieldError.below) && (
        <div className="text-[11px] text-crit mt-0.5">{fieldError.above || fieldError.below}</div>
      )}
      {state.error && <div className="text-[11px] text-ink-faint mt-0.5">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
    </div>
  );
}
```

- [ ] **Step 7: `CardDetailPanel.jsx`**

Nach Zeile 7 (`import PriceHistoryChart from './PriceHistoryChart';`):
```jsx
import PriceAlertTargets from './PriceAlertTargets';
```
Direkt nach der Zeile mit `<PriceHistoryChart key={…} printing={printingOf(variant)} />`:
```jsx
                      <PriceAlertTargets key={`${card.id}|${variant.set_code}|${variant.language || 'DE'}|${variant.rarity}`} printing={printingOf(variant)} />
```

- [ ] **Step 8: `src/components/PriceAlertSettings.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { BellRing } from 'lucide-react';
import { parsePct, parseMinEur, toInput } from '../utils/alertInput';

const DEFAULTS = { pct: 20, min_eur: 2, days: 7, active: false };
const enterBlur = (e) => { if (e.key === 'Enter') e.currentTarget.blur(); };
const inputCls = (bad) => `w-20 bg-obsidian border rounded-lg px-2 py-1 text-ink font-mono ${bad ? 'border-crit' : 'border-line'}`;

// Spec G2 §6.3 — Einstellungen › Preise › Preis-Alarme. Ohne gespeicherte Regel ist der Bewegungsalarm
// aus; die Felder zeigen dann die Standardwerte, und das erste Speichern legt die Regel an.
export default function PriceAlertSettings() {
  const [status, setStatus] = useState(() => (window.api?.getPriceAlertMove ? 'loading' : 'error'));
  const [rule, setRule] = useState(DEFAULTS);
  const [text, setText] = useState({ pct: toInput(DEFAULTS.pct), min_eur: toInput(DEFAULTS.min_eur) });
  const [errors, setErrors] = useState({ pct: null, min_eur: null, save: null });

  useEffect(() => {
    if (!window.api?.getPriceAlertMove) return undefined;
    let alive = true;
    window.api.getPriceAlertMove()
      .then((r) => {
        if (!alive) return;
        const cur = r ? { pct: Number(r.pct), min_eur: Number(r.min_eur), days: Number(r.days), active: !!r.active } : DEFAULTS;
        setRule(cur);
        setText({ pct: toInput(cur.pct), min_eur: toInput(cur.min_eur) });
        setStatus('ready');
      })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, []);

  const save = async (patch) => {
    const pct = parsePct(text.pct);
    const minEur = parseMinEur(text.min_eur);
    setErrors({ pct: pct.error, min_eur: minEur.error, save: null });
    if (pct.error || minEur.error) return;
    const next = { ...rule, pct: pct.value, min_eur: minEur.value, ...patch };
    if (next.pct === rule.pct && next.min_eur === rule.min_eur && next.days === rule.days && next.active === rule.active) return;
    try {
      await window.api.savePriceAlertMove(next);
      setRule(next);
    } catch {
      setErrors((e) => ({ ...e, save: 'Speichern fehlgeschlagen' }));
    }
  };

  return (
    <div className="border-t border-line pt-6">
      <div className="text-sm font-bold text-ink-muted mb-2 uppercase tracking-wider flex items-center gap-2">
        <BellRing className="w-4 h-4" /> Preis-Alarme
      </div>
      {status === 'loading' && <div className="h-10 rounded-lg bg-obsidian-800 animate-pulse" />}
      {status === 'error' && <p className="text-sm text-crit">Preis-Alarme nicht verfügbar — Cloud nicht verbunden.</p>}
      {status === 'ready' && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={rule.active} onChange={(e) => save({ active: e.target.checked })}
              className="accent-space-violet w-4 h-4" />
            Bewegungsalarm
          </label>
          <div className="flex items-center gap-2 flex-wrap text-sm text-ink-muted">
            <span>ab</span>
            <input value={text.pct} inputMode="decimal" aria-label="ab Prozent"
              onChange={(e) => setText((t) => ({ ...t, pct: e.target.value }))}
              onBlur={() => save({})} onKeyDown={enterBlur} className={inputCls(errors.pct)} />
            <span>% und ab</span>
            <input value={text.min_eur} inputMode="decimal" aria-label="ab Euro"
              onChange={(e) => setText((t) => ({ ...t, min_eur: e.target.value }))}
              onBlur={() => save({})} onKeyDown={enterBlur} className={inputCls(errors.min_eur)} />
            <span>€ in</span>
            <select value={rule.days} onChange={(e) => save({ days: Number(e.target.value) })}
              className="bg-obsidian border border-line text-ink rounded-lg px-2 py-1">
              <option value={7}>7 Tagen</option>
              <option value={30}>30 Tagen</option>
            </select>
          </div>
          {(errors.pct || errors.min_eur || errors.save) && (
            <p className="text-xs text-crit">{errors.pct || errors.min_eur || errors.save}</p>
          )}
          <p className="text-xs text-ink-faint">Ausgewertet wird stündlich in der Cloud. Am Handy erscheinen Treffer beim Öffnen.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: `Settings.jsx`**

Nach Zeile 5 (`import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';`):
```jsx
import PriceAlertSettings from './PriceAlertSettings';
```
Im Abschnitt `active === 'preise'` den Fortschrittsblock `{runningAction === 'prices' && progress.total > 0 && ( … )}` unverändert lassen und direkt danach, noch innerhalb von `<div className="space-y-6">`, einfügen:
```jsx

                            <PriceAlertSettings />
```

- [ ] **Step 10: Prüfen**

In `desktop/`:
1. `node --test src/utils/*.test.js src/utils/*.test.mjs` → alle grün.
2. `npx eslint .` → genau `5 errors`.
3. `npx vite build` → erfolgreich.

- [ ] **Step 11: Commit**

```bash
git add docs/fixtures/portfolio/alert-input.json desktop/src/utils/alertInput.js desktop/src/utils/alertInput.test.js desktop/src/components/PriceAlertTargets.jsx desktop/src/components/PriceAlertSettings.jsx desktop/src/components/CardDetailPanel.jsx desktop/src/components/Settings.jsx
git commit -m "feat(g2): Zielpreise im Karten-Panel und Bewegungsalarm in den Einstellungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Handy — Eingabeprüfung, Repository, Speicher, Nachladen im Vordergrund

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/AlertInput.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/AlertInputTest.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/ForegroundTick.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/ForegroundTickTest.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/PriceAlertsRepository.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/PriceAlertsQueriesTest.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt:132-140`

**Interfaces:**
- Consumes (Task 7): `docs/fixtures/portfolio/alert-input.json`.
- Consumes (vorhanden): `SupabaseCloud.base()/key()/token()/http()/signIn()/jsonMedia`, `CardRow`, `ListCache`, `CollectionStore.requestSync()`.
- Produces (für Task 9):
  - `data class AlertParse(val value: Double?, val error: String?)`; `AlertInput.parseTarget(text: String?)`, `parsePct(text: String?)`, `parseMinEur(text: String?)` → `AlertParse`; `AlertInput.toInput(v: Double?): String`
  - `data class PriceAlertEvent(id: Long, kind: String, cardId: String, setCode: String, language: String, rarity: String, oldPrice: Double?, newPrice: Double, pct: Double?, days: Int?, threshold: Double?, day: String)`
  - `data class PriceAlertMoveRule(id: Long, pct: Double, minEur: Double, days: Int, active: Boolean)`
  - `data class PriceAlertTarget(kind: String, cardId: String, setCode: String, language: String, rarity: String, threshold: Double, armed: Boolean)` mit `key(): String` = `"$cardId|$setCode|$language|$rarity"` (gleich `CardRow.printingKey()`)
  - `PriceAlertsRepository.loadEvents()`, `loadMoveRule()`, `loadTargets()`, `dismissEvent(id: Long)`, `dismissAllEvents()`, `saveMoveRule(pct: Double, minEur: Double, days: Int, active: Boolean)`, `saveTarget(card: CardRow, kind: String, threshold: Double?)` (alle `suspend`, werfen bei Fehler)
  - `SideStores.priceAlertEvents: ListCache<List<PriceAlertEvent>>`, `priceAlertMoveRule: ListCache<List<PriceAlertMoveRule>>` (0 oder 1 Element), `priceAlertTargets: ListCache<List<PriceAlertTarget>>`

- [ ] **Step 1: Tests schreiben**

`android/app/src/test/java/com/example/yugiohscanner/AlertInputTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.AlertInput
import com.example.yugiohscanner.ml.AlertParse
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/alertInput.test.js -- dieselbe Fixture docs/fixtures/portfolio/alert-input.json. */
class AlertInputTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/portfolio/alert-input.json"))

    private fun check(cases: JSONArray, fn: (String) -> AlertParse) {
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val input = c.getString("in")
            val expected = AlertParse(
                if (c.isNull("value")) null else c.getDouble("value"),
                if (c.isNull("error")) null else c.getString("error"),
            )
            assertEquals("\"$input\"", expected, fn(input))
        }
    }

    @Test fun `Zielpreis`() = check(fix.getJSONArray("target")) { AlertInput.parseTarget(it) }
    @Test fun `Prozent`() = check(fix.getJSONArray("pct")) { AlertInput.parsePct(it) }
    @Test fun `Mindestbetrag`() = check(fix.getJSONArray("minEur")) { AlertInput.parseMinEur(it) }

    @Test fun `Anzeige im Feld`() {
        val cases = fix.getJSONArray("toInput")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            assertEquals(c.getString("out"), AlertInput.toInput(if (c.isNull("in")) null else c.getDouble("in")))
        }
    }
}
```

`android/app/src/test/java/com/example/yugiohscanner/ForegroundTickTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.ForegroundTick
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Spec G2 §7: beim Eintritt in den Vordergrund werden die Preis-Alarme einmal nachgeladen, der
 * 10-s-Abgleich laeuft weiter. Bewusst im Test-Scope (nicht backgroundScope) gestartet und mit
 * advanceTimeBy/runCurrent getrieben -- advanceUntilIdle wuerde an der Endlosschleife haengen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ForegroundTickTest {
    @Test fun `Eintritt laedt einmal, der Takt laeuft weiter`() = runTest {
        var enters = 0
        var ticks = 0
        val job = launch { ForegroundTick.run(onEnter = { enters++ }, tick = { ticks++ }) }
        runCurrent()
        assertEquals(1, enters)
        assertEquals(1, ticks)
        advanceTimeBy(10_000)
        runCurrent()
        assertEquals(1, enters)
        assertEquals(2, ticks)
        job.cancel()
    }

    @Test fun `jede Rueckkehr in den Vordergrund laedt erneut`() = runTest {
        var enters = 0
        repeat(2) {
            val job = launch { ForegroundTick.run(onEnter = { enters++ }, tick = {}) }
            runCurrent()
            job.cancel()
        }
        assertEquals(2, enters)
    }
}
```

`android/app/src/test/java/com/example/yugiohscanner/PriceAlertsQueriesTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.PriceAlertEvent
import com.example.yugiohscanner.cloud.PriceAlertMoveRule
import com.example.yugiohscanner.cloud.PriceAlertTarget
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PriceAlertsQueriesTest {
    private val card = CardRow("1", "LOB-DE001", "DE", "A", null, null, 1, 2.0)

    @Test fun `offene Treffer, neueste zuerst, hoechstens 200`() {
        assertEquals(
            listOf("select" to "*", "dismissed" to "eq.false", "order" to "id.desc", "limit" to "200"),
            PriceAlertsRepository.eventsParams(),
        )
    }

    @Test fun `Bewegungsregel und aktive Zielpreise`() {
        assertEquals(
            listOf("select" to "id,pct,min_eur,days,active", "kind" to "eq.move", "limit" to "1"),
            PriceAlertsRepository.moveRuleParams(),
        )
        assertEquals(
            listOf(
                "select" to "kind,card_id,set_code,language,rarity,threshold,armed",
                "kind" to "in.(above,below)", "active" to "eq.true",
            ),
            PriceAlertsRepository.targetsParams(),
        )
    }

    @Test fun `Zielpreis-Schluessel, fehlende Raritaet als Unknown`() {
        assertEquals(
            listOf("kind" to "eq.below", "card_id" to "eq.1", "set_code" to "eq.LOB-DE001", "language" to "eq.DE", "rarity" to "eq.Unknown"),
            PriceAlertsRepository.targetKeyParams(card, "below"),
        )
        assertEquals("user_id,kind,card_id,set_code,language,rarity", PriceAlertsRepository.TARGET_CONFLICT)
        val body = PriceAlertsRepository.targetBody(card, "above", 12.5)
        assertEquals("above", body.getString("kind"))
        assertEquals("Unknown", body.getString("rarity"))
        assertEquals(12.5, body.getDouble("threshold"), 1e-9)
        assertEquals(true, body.getBoolean("active"))
        assertEquals(true, body.getBoolean("armed"))
        assertEquals(false, body.has("user_id"))
    }

    @Test fun `parse Treffer mit Nullwerten`() {
        val e = PriceAlertsRepository.parseEvents(
            """[{"id":7,"kind":"below","card_id":"1","set_code":"Unknown","language":"DE","rarity":"Common","old_price":null,"new_price":4,"pct":null,"days":null,"threshold":5,"day":"2026-09-14","dismissed":false}]""",
        )
        assertEquals(listOf(PriceAlertEvent(7, "below", "1", "Unknown", "DE", "Common", null, 4.0, null, null, 5.0, "2026-09-14")), e)
    }

    @Test fun `parse Bewegungsregel und Zielpreise`() {
        assertNull(PriceAlertsRepository.parseMoveRule("[]"))
        assertEquals(
            PriceAlertMoveRule(3, 20.0, 2.0, 7, true),
            PriceAlertsRepository.parseMoveRule("""[{"id":3,"pct":20,"min_eur":2,"days":7,"active":true}]"""),
        )
        val t = PriceAlertsRepository.parseTargets(
            """[{"kind":"above","card_id":"1","set_code":"LOB-DE001","language":"DE","rarity":"Unknown","threshold":50,"armed":false}]""",
        )
        assertEquals(listOf(PriceAlertTarget("above", "1", "LOB-DE001", "DE", "Unknown", 50.0, false)), t)
        assertEquals("1|LOB-DE001|DE|Unknown", t[0].key())
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL — `Unresolved reference: AlertInput`, `ForegroundTick`, `PriceAlertsRepository`.

- [ ] **Step 3: `ml/AlertInput.kt`**

```kotlin
package com.example.yugiohscanner.ml

/** Ergebnis einer Eingabe. value null und error null heisst "leer" (nur beim Zielpreis erlaubt: entfernen). */
data class AlertParse(val value: Double?, val error: String?)

/**
 * Spec G2 §7/§9 -- Eingabepruefung der Preis-Alarme (deutsches Komma, kein Tausenderpunkt).
 * ZWILLING: desktop/src/utils/alertInput.js. Beide laufen gegen docs/fixtures/portfolio/alert-input.json.
 * Wer eine Seite aendert, aendert beide.
 */
object AlertInput {
    private val EURO = Regex("""^\d+([.,]\d{1,2})?$""")
    private val PCT = Regex("""^\d+([.,]\d)?$""")

    private fun num(t: String): Double = t.replace(',', '.').toDouble()

    fun parseTarget(text: String?): AlertParse {
        val t = text.orEmpty().trim()
        if (t.isEmpty()) return AlertParse(null, null)
        if (!EURO.matches(t)) return AlertParse(null, "Ungültiger Betrag")
        val v = num(t)
        return if (v > 0) AlertParse(v, null) else AlertParse(null, "Betrag muss größer als 0 sein")
    }

    fun parsePct(text: String?): AlertParse {
        val t = text.orEmpty().trim()
        if (!PCT.matches(t)) return AlertParse(null, "Ungültige Zahl")
        val v = num(t)
        return if (v in 1.0..500.0) AlertParse(v, null) else AlertParse(null, "Prozent zwischen 1 und 500")
    }

    fun parseMinEur(text: String?): AlertParse {
        val t = text.orEmpty().trim()
        if (!EURO.matches(t)) return AlertParse(null, "Ungültiger Betrag")
        return AlertParse(num(t), null)
    }

    /** Wie JS String(Number(v)): 2.0 -> "2", 12.5 -> "12,5", null -> "". */
    fun toInput(v: Double?): String {
        if (v == null) return ""
        val s = if (v == Math.floor(v) && Math.abs(v) < 1e15) v.toLong().toString() else v.toString()
        return s.replace('.', ',')
    }
}
```

- [ ] **Step 4: `ml/ForegroundTick.kt`**

```kotlin
package com.example.yugiohscanner.ml

import kotlinx.coroutines.delay

/**
 * Spec G2 §7 -- was beim Eintritt in den Vordergrund passiert: einmal `onEnter` (Preis-Alarme nachladen),
 * danach alle `periodMs` ein `tick` (der bestehende Abgleich). AppNav ruft das in
 * repeatOnLifecycle(STARTED) auf; jede Rueckkehr startet den Block und damit `onEnter` neu.
 */
object ForegroundTick {
    suspend fun run(onEnter: () -> Unit, tick: () -> Unit, periodMs: Long = 10_000) {
        onEnter()
        while (true) {
            tick()
            delay(periodMs)
        }
    }
}
```

- [ ] **Step 5: `cloud/PriceAlertsRepository.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

data class PriceAlertEvent(
    val id: Long, val kind: String, val cardId: String, val setCode: String, val language: String, val rarity: String,
    val oldPrice: Double?, val newPrice: Double, val pct: Double?, val days: Int?, val threshold: Double?, val day: String,
)

data class PriceAlertMoveRule(val id: Long, val pct: Double, val minEur: Double, val days: Int, val active: Boolean)

data class PriceAlertTarget(
    val kind: String, val cardId: String, val setCode: String, val language: String, val rarity: String,
    val threshold: Double, val armed: Boolean,
) {
    /** Gleich CardRow.printingKey(). */
    fun key(): String = "$cardId|$setCode|$language|$rarity"
}

/**
 * Spec G2 §7 -- Preis-Alarme ueber REST (supabase/price_alerts_schema.sql). Ausgewertet wird nur in der
 * Cloud (Edge Function evaluate-price-alerts); das Handy liest Treffer, erledigt sie und pflegt Regeln.
 * Auth/Reauth wie DealsRepository.
 */
object PriceAlertsRepository {
    const val TARGET_CONFLICT = "user_id,kind,card_id,set_code,language,rarity"

    fun eventsParams(): List<Pair<String, String>> = listOf(
        "select" to "*", "dismissed" to "eq.false", "order" to "id.desc", "limit" to "200",
    )

    fun moveRuleParams(): List<Pair<String, String>> = listOf(
        "select" to "id,pct,min_eur,days,active", "kind" to "eq.move", "limit" to "1",
    )

    fun targetsParams(): List<Pair<String, String>> = listOf(
        "select" to "kind,card_id,set_code,language,rarity,threshold,armed",
        "kind" to "in.(above,below)", "active" to "eq.true",
    )

    fun targetKeyParams(card: CardRow, kind: String): List<Pair<String, String>> = listOf(
        "kind" to "eq.$kind", "card_id" to "eq.${card.id}", "set_code" to "eq.${card.setCode}",
        "language" to "eq.${card.language}", "rarity" to "eq.${card.rarity ?: "Unknown"}",
    )

    /** Ohne user_id: die Spalte hat den Standard auth.uid(). Setzen macht den Zielpreis wieder scharf (Spec §4.1). */
    fun targetBody(card: CardRow, kind: String, threshold: Double): JSONObject = JSONObject()
        .put("kind", kind).put("card_id", card.id).put("set_code", card.setCode)
        .put("language", card.language).put("rarity", card.rarity ?: "Unknown")
        .put("threshold", threshold).put("active", true).put("armed", true)

    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)

    fun parseEvents(text: String): List<PriceAlertEvent> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PriceAlertEvent(
                id = o.getLong("id"), kind = o.getString("kind"), cardId = o.getString("card_id"),
                setCode = o.getString("set_code"), language = o.getString("language"), rarity = o.getString("rarity"),
                oldPrice = dbl(o, "old_price"), newPrice = o.getDouble("new_price"), pct = dbl(o, "pct"),
                days = if (o.isNull("days")) null else o.getInt("days"), threshold = dbl(o, "threshold"),
                day = o.getString("day"),
            )
        }
    }

    fun parseMoveRule(text: String): PriceAlertMoveRule? {
        val arr = JSONArray(text)
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        return PriceAlertMoveRule(
            id = o.getLong("id"), pct = o.getDouble("pct"), minEur = o.getDouble("min_eur"),
            days = o.getInt("days"), active = o.getBoolean("active"),
        )
    }

    fun parseTargets(text: String): List<PriceAlertTarget> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PriceAlertTarget(
                kind = o.getString("kind"), cardId = o.getString("card_id"), setCode = o.getString("set_code"),
                language = o.getString("language"), rarity = o.getString("rarity"),
                threshold = o.getDouble("threshold"), armed = o.getBoolean("armed"),
            )
        }
    }

    suspend fun loadEvents(): List<PriceAlertEvent> = parseEvents(getText("price_alert_events", eventsParams()))

    suspend fun loadMoveRule(): PriceAlertMoveRule? = parseMoveRule(getText("price_alert_rules", moveRuleParams()))

    suspend fun loadTargets(): List<PriceAlertTarget> = parseTargets(getText("price_alert_rules", targetsParams()))

    suspend fun dismissEvent(id: Long) =
        patch("price_alert_events", listOf("id" to "eq.$id"), JSONObject().put("dismissed", true), "Erledigen")

    suspend fun dismissAllEvents() =
        patch("price_alert_events", listOf("dismissed" to "eq.false"), JSONObject().put("dismissed", true), "Alle erledigen")

    /** Ohne Zeile ist der Bewegungsalarm aus; die erste Speicherung legt sie an (Spec §4.1). */
    suspend fun saveMoveRule(pct: Double, minEur: Double, days: Int, active: Boolean) {
        val body = JSONObject().put("pct", pct).put("min_eur", minEur).put("days", days).put("active", active)
        val current = loadMoveRule()
        if (current != null) {
            patch("price_alert_rules", listOf("id" to "eq.${current.id}"), body, "Bewegungsalarm speichern")
        } else {
            post("price_alert_rules", emptyList(), body.put("kind", "move"), "Bewegungsalarm speichern", upsert = false)
        }
    }

    /** threshold null = entfernen (active = false; Treffer bleiben). */
    suspend fun saveTarget(card: CardRow, kind: String, threshold: Double?) {
        if (threshold == null) {
            patch("price_alert_rules", targetKeyParams(card, kind), JSONObject().put("active", false), "Zielpreis entfernen")
        } else {
            post("price_alert_rules", listOf("on_conflict" to TARGET_CONFLICT), targetBody(card, kind, threshold), "Zielpreis speichern", upsert = true)
        }
    }

    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun getText(table: String, params: List<Pair<String, String>>): String =
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Preis-Alarme laden fehlgeschlagen (${r.code}): $text")
            text
        }

    private suspend fun patch(table: String, params: List<Pair<String, String>>, body: JSONObject, what: String) {
        executeWithReauth {
            base(url(table, params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private suspend fun post(table: String, params: List<Pair<String, String>>, body: JSONObject, what: String, upsert: Boolean) {
        executeWithReauth {
            base(url(table, params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", if (upsert) "resolution=merge-duplicates,return=minimal" else "return=minimal")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    // Bei 401 (Token nach ~1 h abgelaufen) einmal neu anmelden und wiederholen.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
```

- [ ] **Step 6: `SideStores.kt`**

Nach `val snapshots = ListCache(scope) { SnapshotsRepository.loadSnapshots() }`:
```kotlin

    // Spec G2 §7: Preis-Alarme. Treffer laden beim Eintritt in den Vordergrund (AppNav) und per Ziehen,
    // Regeln einmal und nach eigenem Speichern. Die Bewegungsregel als Liste mit 0 oder 1 Element, weil
    // ListCache "null" fuer "noch nie geladen" braucht.
    val priceAlertEvents = ListCache(scope) { PriceAlertsRepository.loadEvents() }
    val priceAlertMoveRule = ListCache(scope) { listOfNotNull(PriceAlertsRepository.loadMoveRule()) }
    val priceAlertTargets = ListCache(scope) { PriceAlertsRepository.loadTargets() }
```
In `clearAll()` die Zeile `reference7.clear(); reference30.clear(); snapshots.clear()` ersetzen durch:
```kotlin
        reference7.clear(); reference30.clear(); snapshots.clear()
        priceAlertEvents.clear(); priceAlertMoveRule.clear(); priceAlertTargets.clear()
```

- [ ] **Step 7: `AppNav.kt`**

Import ergänzen (bei den übrigen `com.example.yugiohscanner`-Imports):
```kotlin
import com.example.yugiohscanner.ml.ForegroundTick
```
Den Block Zeilen 130–140 ersetzen durch:
```kotlin
    // Spec §3.4: solange die App sichtbar ist, alle 10 s ein Abgleich; im Hintergrund keiner.
    // repeatOnLifecycle startet den Block beim Zurueckkommen neu -- das ist der sofortige Abgleich.
    // Spec G2 §7: beim selben Eintritt die Preis-Alarme nachladen (nicht bei Seitenwechseln).
    LaunchedEffect(cloudReady) {
        if (!cloudReady) return@LaunchedEffect
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            ForegroundTick.run(
                onEnter = { SideStores.priceAlertEvents.refresh() },
                tick = { CollectionStore.requestSync() },
            )
        }
    }
```
Danach per Grep prüfen, dass `delay` in `AppNav.kt` noch benutzt wird; wenn nicht, den Import `kotlinx.coroutines.delay` entfernen.

- [ ] **Step 8: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün (neu: AlertInputTest 4, ForegroundTickTest 2, PriceAlertsQueriesTest 5).

- [ ] **Step 9: Schutz-Nachweis**

In `ForegroundTick.run` die Zeile `onEnter()` kurz auskommentieren, `--tests "com.example.yugiohscanner.ForegroundTickTest"` laufen lassen, den Fehlschlag (`expected:<1> but was:<0>`) im Bericht zitieren, Zeile wiederherstellen, Test wieder grün.

- [ ] **Step 10: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/AlertInput.kt android/app/src/test/java/com/example/yugiohscanner/AlertInputTest.kt android/app/src/main/java/com/example/yugiohscanner/ml/ForegroundTick.kt android/app/src/test/java/com/example/yugiohscanner/ForegroundTickTest.kt android/app/src/main/java/com/example/yugiohscanner/cloud/PriceAlertsRepository.kt android/app/src/test/java/com/example/yugiohscanner/PriceAlertsQueriesTest.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt
git commit -m "feat(g2): Handy laedt Preis-Alarme im Vordergrund, Repository und Eingabepruefung

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: Handy-Ansichten — Start, Insights-Reiter, Kartendetail, Einstellungen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/PriceAlertsSection.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/PriceAlertTargetsRow.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/PriceAlertSettings.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt` (Route `INSIGHTS`, Start-Callbacks Zeile 196, Composable Zeilen 199–202)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt` (Signatur Zeile 85, `onRefresh` Zeilen 164–169, Einbau vor `MoversSection` Zeile 284)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/InsightsScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt:174`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt` (nach dem Abschnitt „Preise", Zeile 179)

**Interfaces:**
- Consumes (Task 4): `AlertText.of(...)`. (Task 8): `AlertInput`, `PriceAlertsRepository`, `PriceAlertEvent`, `PriceAlertTarget`, `SideStores.priceAlertEvents/priceAlertMoveRule/priceAlertTargets`.
- Produces: `PriceAlertsSection(full: Boolean, onOpenCard: (String) -> Unit, onOpenAll: (() -> Unit)?)`, `PriceAlertTargetsRow(card: CardRow)`, `PriceAlertSettingsSection()`; Route `Routes.INSIGHTS = "start/insights?tab={tab}"`, `Routes.insights(tab)`.

Keine Compose-UI-Tests im Projekt; die Regeln liegen in den getesteten Helfern aus Task 4/8. Prüfung per Build und am Gerät (Controller-Abnahme).

- [ ] **Step 1: `ui/PriceAlertsSection.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.PriceAlertEvent
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ml.AlertText
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

/**
 * Spec G2 §7 -- offene Preis-Alarme. Start (`full = false`) zeigt zwei Zeilen und erscheint nur bei
 * bekannten offenen Treffern; Insights (`full = true`) zeigt alle, Lade-/Fehler-/Leerzustand und
 * "Alle erledigt". Texte aus ml/AlertText.kt (Zwilling von electron/alert-text.cjs).
 */
@Composable
fun PriceAlertsSection(full: Boolean, onOpenCard: (String) -> Unit, onOpenAll: (() -> Unit)?) {
    val cacheState by SideStores.priceAlertEvents.state.collectAsState()
    val events = cacheState.value
    if (!full && events.isNullOrEmpty()) return

    val store by CollectionStore.state.collectAsState()
    val cards = (store as? StoreState.Ready)?.cards
    // Nur die Namen der angezeigten Treffer; gemerkt, damit nicht jede Komposition die Sammlung durchlaeuft.
    val names = remember(cards, events) {
        val ids = events?.map { it.cardId }?.toSet() ?: emptySet()
        cards?.filter { it.id in ids && it.name != null }?.associate { it.id to it.name!! } ?: emptyMap()
    }
    val scope = rememberCoroutineScope()
    var actionError by remember { mutableStateOf<String?>(null) }

    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                SectionHeader(if (full) "Preis-Alarme" else "Preis-Alarme (${events?.size ?: 0})")
                Spacer(Modifier.weight(1f))
                if (onOpenAll != null) {
                    Text("Alle", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable { onOpenAll() }.padding(4.dp))
                }
                if (full && !events.isNullOrEmpty()) {
                    Text("Alle erledigt", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable {
                            scope.launch {
                                try {
                                    PriceAlertsRepository.dismissAllEvents()
                                    SideStores.priceAlertEvents.update { emptyList() }
                                    actionError = null
                                } catch (e: Exception) {
                                    actionError = "Erledigen fehlgeschlagen."
                                }
                            }
                        }.padding(4.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            actionError?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor)
                Spacer(Modifier.height(4.dp))
            }
            when {
                events == null && cacheState.error != null && !cacheState.loading ->
                    Text("Preis-Alarme konnten nicht geladen werden — zum Aktualisieren ziehen",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                events == null ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        repeat(3) { Box(Modifier.fillMaxWidth().height(28.dp).background(Line, RoundedCornerShape(6.dp))) }
                    }
                else -> {
                    if (cacheState.error != null) {
                        Text("Stand von zuvor — Aktualisieren fehlgeschlagen.", style = MaterialTheme.typography.labelSmall, color = Muted)
                        Spacer(Modifier.height(4.dp))
                    }
                    if (events.isEmpty()) {
                        Text("Keine offenen Preis-Alarme", style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                    (if (full) events else events.take(2)).forEach { e ->
                        AlertRow(e, names[e.cardId], onOpenCard) {
                            scope.launch {
                                try {
                                    PriceAlertsRepository.dismissEvent(e.id)
                                    SideStores.priceAlertEvents.update { list -> list.filterNot { it.id == e.id } }
                                    actionError = null
                                } catch (ex: Exception) {
                                    actionError = "Erledigen fehlgeschlagen."
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AlertRow(e: PriceAlertEvent, name: String?, onOpenCard: (String) -> Unit, onDismiss: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).clickable { onOpenCard(e.cardId) }.padding(vertical = 4.dp)) {
            Text(UtcDay.formatDe(e.day), style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
            Text(
                AlertText.of(e.kind, name, e.cardId, e.setCode, e.rarity, e.oldPrice, e.newPrice, e.pct, e.days, e.threshold),
                style = MaterialTheme.typography.bodySmall, color = OnSurface, maxLines = 2,
            )
        }
        TextButton(onClick = onDismiss) { Text("Erledigt") }
    }
}
```

- [ ] **Step 2: `ui/PriceAlertTargetsRow.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.PriceAlertTarget
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.AlertInput
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Muted
import kotlinx.coroutines.launch

/**
 * Spec G2 §7 -- "Preis-Alarm: ≥ [ ] € · ≤ [ ] €" unter dem Preisverlauf eines Printings. Gespeichert wird
 * mit "Fertig" und nur bei geaenderter Eingabe: jedes Speichern macht den Zielpreis wieder scharf
 * (Spec §4.1). Leer = entfernen. "ausgelöst" neben einem entschaerften Zielpreis.
 */
@Composable
fun PriceAlertTargetsRow(card: CardRow) {
    val cache = SideStores.priceAlertTargets
    val cacheState by cache.state.collectAsState()
    LaunchedEffect(Unit) { cache.ensureLoaded() }
    val targets = cacheState.value
    if (targets == null) {
        if (cacheState.error != null && !cacheState.loading) {
            Text("Preis-Alarm: nicht verfügbar", style = MaterialTheme.typography.labelSmall, color = Muted)
        }
        return
    }
    val key = card.printingKey()
    val above = targets.firstOrNull { it.kind == "above" && it.key() == key }
    val below = targets.firstOrNull { it.kind == "below" && it.key() == key }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text("Preis-Alarm", style = MaterialTheme.typography.labelSmall, color = Muted)
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TargetField("≥", above, card, "above")
            TargetField("≤", below, card, "below")
        }
    }
}

@Composable
private fun RowScope.TargetField(sign: String, current: PriceAlertTarget?, card: CardRow, kind: String) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var text by remember(current?.threshold) { mutableStateOf(AlertInput.toInput(current?.threshold)) }
    var error by remember { mutableStateOf<String?>(null) }

    fun commit() {
        val parsed = AlertInput.parseTarget(text)
        if (parsed.error != null) { error = parsed.error; return }
        focus.clearFocus()
        if (parsed.value == current?.threshold) return
        scope.launch {
            try {
                PriceAlertsRepository.saveTarget(card, kind, parsed.value)
                SideStores.priceAlertTargets.refreshAndWait()
                error = null
            } catch (e: Exception) {
                error = "Speichern fehlgeschlagen"
            }
        }
    }

    Column(Modifier.weight(1f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(sign, style = MaterialTheme.typography.bodyMedium, color = Muted)
            Spacer(Modifier.width(4.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; error = null },
                modifier = Modifier.weight(1f),
                singleLine = true,
                isError = error != null,
                textStyle = MaterialTheme.typography.bodySmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { commit() }),
            )
            Spacer(Modifier.width(4.dp))
            Text("€", style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
        if (current != null && !current.armed) {
            Text("ausgelöst", style = MaterialTheme.typography.labelSmall, color = Gold)
        }
        error?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = ErrorColor) }
    }
}
```

- [ ] **Step 3: `ui/PriceAlertSettings.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.PriceAlertsRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.AlertInput
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.launch

/**
 * Spec G2 §7 -- Einstellungen › Preise › Preis-Alarme, wie am Desktop. Ohne gespeicherte Regel ist der
 * Bewegungsalarm aus; die Felder zeigen 20 % · 2 € · 7 Tage, das erste Speichern legt die Regel an.
 */
@Composable
fun PriceAlertSettingsSection() {
    val cache = SideStores.priceAlertMoveRule
    val st by cache.state.collectAsState()
    LaunchedEffect(Unit) { cache.ensureLoaded() }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader("Preis-Alarme")
        val loaded = st.value
        if (loaded == null) {
            if (st.error != null && !st.loading) {
                Text("Preis-Alarme nicht verfügbar — Cloud nicht verbunden.", style = MaterialTheme.typography.bodySmall, color = ErrorColor)
            } else {
                Text("Wird geladen …", style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            return@Column
        }
        val rule = loaded.firstOrNull()
        var active by remember(rule) { mutableStateOf(rule?.active ?: false) }
        var days by remember(rule) { mutableStateOf(rule?.days ?: 7) }
        var pctText by remember(rule) { mutableStateOf(AlertInput.toInput(rule?.pct ?: 20.0)) }
        var eurText by remember(rule) { mutableStateOf(AlertInput.toInput(rule?.minEur ?: 2.0)) }
        var error by remember { mutableStateOf<String?>(null) }

        fun save(nextActive: Boolean = active, nextDays: Int = days) {
            val pct = AlertInput.parsePct(pctText)
            val eur = AlertInput.parseMinEur(eurText)
            error = pct.error ?: eur.error
            if (error != null) return
            val p = pct.value!!
            val m = eur.value!!
            if (rule != null && rule.active == nextActive && rule.days == nextDays && rule.pct == p && rule.minEur == m) return
            active = nextActive
            days = nextDays
            scope.launch {
                try {
                    PriceAlertsRepository.saveMoveRule(p, m, nextDays, nextActive)
                    cache.refreshAndWait()
                } catch (e: Exception) {
                    error = "Speichern fehlgeschlagen"
                }
            }
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Bewegungsalarm", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = OnSurface)
            Switch(checked = active, onCheckedChange = { save(nextActive = it) })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = pctText, onValueChange = { pctText = it; error = null },
                modifier = Modifier.weight(1f), singleLine = true, label = { Text("ab … %") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); save() }),
            )
            OutlinedTextField(
                value = eurText, onValueChange = { eurText = it; error = null },
                modifier = Modifier.weight(1f), singleLine = true, label = { Text("ab … €") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { focus.clearFocus(); save() }),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(7, 30).forEach { d ->
                FilterChip(selected = days == d, onClick = { save(nextDays = d) }, label = { Text("$d Tage") })
            }
        }
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = ErrorColor) }
        Text("Ausgewertet wird stündlich in der Cloud. Am Handy erscheinen Treffer beim Öffnen.",
            style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}
```

- [ ] **Step 4: `AppNav.kt` — Route mit Reiter**

In `object Routes` die Zeile `const val INSIGHTS = "start/insights"` ersetzen durch:
```kotlin
    // Spec G2 §7: Reiter als optionales Argument, damit "Alle" auf der Alarm-Karte direkt "Alarme" oeffnet.
    const val INSIGHTS = "start/insights?tab={tab}"
    fun insights(tab: String = "bewegungen") = "start/insights?tab=$tab"
```
In `composable(Routes.START)` die Zeile `onOpenInsights = { nav.navigate(Routes.INSIGHTS) { launchSingleTop = true } },` ersetzen durch:
```kotlin
                    onOpenInsights = { nav.navigate(Routes.insights()) { launchSingleTop = true } },
                    onOpenAlerts = { nav.navigate(Routes.insights("alarme")) { launchSingleTop = true } },
```
Den Block `composable(Routes.INSIGHTS) { … }` ersetzen durch:
```kotlin
            composable(
                Routes.INSIGHTS,
                arguments = listOf(navArgument("tab") { type = NavType.StringType; defaultValue = "bewegungen" }),
            ) { backStackEntry ->
                if (cloudReady) InsightsScreen(
                    initialTab = backStackEntry.arguments?.getString("tab") ?: "bewegungen",
                    onBack = { nav.popBackStack() },
                )
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
```
Per Grep prüfen, dass `Routes.INSIGHTS` sonst nirgends als Navigationsziel benutzt wird und die untere Leiste Insights weiter unter „Start" markiert (erstes Segment bleibt `start`).

- [ ] **Step 5: `StartScreen.kt`**

Signatur: nach `onOpenInsights: () -> Unit,` ergänzen:
```kotlin
    onOpenAlerts: () -> Unit,
```
`RefreshableBox(onRefresh = { … })` — nach `SideStores.dealAlerts.refreshAndWait()` ergänzen:
```kotlin
            SideStores.priceAlertEvents.refreshAndWait()
```
Vor der Zeile `MoversSection(days = 7, top = 3, full = false, onOpenCard = { detailId = it }, onOpenAll = onOpenInsights)`:
```kotlin
            // Spec G2 §7: Preis-Alarme direkt über den Bewegungen, nur bei offenen Treffern.
            PriceAlertsSection(full = false, onOpenCard = { detailId = it }, onOpenAll = onOpenAlerts)

```

- [ ] **Step 6: `InsightsScreen.kt`**

Signatur und Reiterzustand:
```kotlin
fun InsightsScreen(initialTab: String = "bewegungen", onBack: () -> Unit) {
```
```kotlin
    var tab by rememberSaveable { mutableStateOf(initialTab) }
```
`RefreshableBox(onRefresh = { … })` ersetzen durch:
```kotlin
        RefreshableBox(onRefresh = {
            CollectionStore.awaitSync()
            SideStores.reference(days).refreshAndWait()
            SideStores.priceAlertEvents.refreshAndWait()
        }) {
```
`TabRow` ersetzen durch:
```kotlin
                TabRow(selectedTabIndex = when (tab) { "aufteilung" -> 1; "alarme" -> 2; else -> 0 }) {
                    Tab(selected = tab == "bewegungen", onClick = { tab = "bewegungen" }, text = { Text("Bewegungen") })
                    Tab(selected = tab == "aufteilung", onClick = { tab = "aufteilung" }, text = { Text("Aufteilung") })
                    Tab(selected = tab == "alarme", onClick = { tab = "alarme" }, text = { Text("Alarme") })
                }
```
Nach dem Block `if (tab == "aufteilung") { … }` (vor den schließenden Klammern der Column):
```kotlin
                if (tab == "alarme") {
                    PriceAlertsSection(full = true, onOpenCard = { detailId = it }, onOpenAll = null)
                }
```

- [ ] **Step 7: `CardDetailScreen.kt:174`**

Nach `PriceHistoryChart(v)`:
```kotlin
                    PriceAlertTargetsRow(v)
```

- [ ] **Step 8: `SettingsScreen.kt`**

Nach dem schließenden `}` der Column des Abschnitts `// ---- Preise ----` (vor `// ---- Standards ----`):
```kotlin

        // ---- Preis-Alarme (Spec G2) ----------------------------------------
        PriceAlertSettingsSection()
```

- [ ] **Step 9: Build und Tests**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün. Per Grep bestätigen, dass kein sichtbarer Text „Unknown" oder „Taschen" in den neuen Dateien steht.

- [ ] **Step 10: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/PriceAlertsSection.kt android/app/src/main/java/com/example/yugiohscanner/ui/PriceAlertTargetsRow.kt android/app/src/main/java/com/example/yugiohscanner/ui/PriceAlertSettings.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/InsightsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt
git commit -m "feat(g2): Preis-Alarme am Handy auf Start, in Insights, im Kartendetail und in den Einstellungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Deno (`deno test --allow-read supabase/functions/`), Desktop SQLite-Suite, Desktop-Helfer, Lint genau 5, `npx vite build`, Android `testDebugUnitTest assembleDebug`. Zahlen im Ledger festhalten.
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (`review-package` Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review.
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge (Spec §11):**
  1. `supabase/price_alerts_schema.sql` im Dashboard einspielen.
  2. Aus dem Repo-Stammverzeichnis: `supabase functions deploy evaluate-price-alerts --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn` (optional vorher Secret `ALERTS_TRIGGER_SECRET`, dann Header im Cron-SQL ergänzen).
  3. `supabase/price_alerts_cron.sql` einspielen.
- [ ] **Installer:** nicht aus dem Worktree mit Junction-`node_modules` bauen — vorher Junction durch `robocopy`-Kopie ersetzen oder nach dem Merge im Hauptcheckout bauen. Stiller NSIS-Installer `/S` startet die App selbst.
- [ ] **APK** per adb auf `22X0219322003405` installieren.
- [ ] **Abnahme** (Checkliste im Ledger): Bewegungsalarm in beiden Einstellungen sichtbar und speicherbar; Zielpreis knapp unter dem aktuellen Preis setzen, Funktion auslösen oder :15 abwarten → Treffer auf Start und im Reiter „Alarme" auf beiden Geräten; genau eine Windows-Benachrichtigung, Klick öffnet Insights › Alarme; „ausgelöst" im Karten-Panel und Kartendetail; „Erledigt" auf einem Gerät entfernt ihn auf beiden (Desktop nach ≤ 20 s, Handy nach Vordergrundwechsel oder Ziehen); Deals-Seite heißt „Deals"; ohne Cloud-Login zeigt der Desktop „Cloud nicht verbunden".
- [ ] **Merge-Frage** an den Nutzer.
