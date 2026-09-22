# eBay in der Cloud (Verbinden & Einstellen)

Verbindet die App mit eBay: `ebay-auth` verwaltet Verbindung und Einrichtung (Zahlungs-/Versand-/
Rücknahme-Richtlinie, Standort), `ebay-sync` gleicht alle 5 Minuten die eBay-Angebote gegen den
Soll-Zustand der App ab. Design: `docs/superpowers/plans/2026-09-22-spec-h3b1-ebay-verbinden-einstellen.md`.

Projekt-Ref wie bei den anderen Funktionen: `uirfqwklvavgjklgqpnn`.

## 1. SQL einspielen

Dashboard › SQL Editor › Inhalt von `supabase/ebay_schema.sql` › Run. **Idempotent** — darf
beliebig oft wiederholt werden (nur `create … if not exists`, `drop … if exists`, `on conflict`).

**Vor** dem Deploy und **vor** dem neuen PC-/Handy-Build (ohne die Tabellen protokolliert der PC
je Abgleich `[sync] ebay_listings pull: …` bzw. `[sync] listing_photos …` und zeigt „wartet auf
eBay“; alle anderen Ströme laufen weiter; das Handy zeigt „eBay-Stand nicht geladen“).

Prüfabfragen:

```sql
select table_name as tabelle, count(*) as spalten
  from information_schema.columns
 where table_schema = 'public' and table_name in ('ebay_account', 'ebay_listings', 'listing_photos', 'ebay_status')
 group by table_name order by table_name;
select tablename as tabelle, policyname as regel
  from pg_policies
 where schemaname = 'public' and tablename in ('ebay_account', 'ebay_listings', 'listing_photos')
 order by tablename;
select policyname as regel from pg_policies where schemaname = 'storage' and policyname = 'listing_photos_objects_insert';
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'listing-photos';
select proname as funktion from pg_proc where proname in ('ebay_try_lock', 'ebay_unlock') order by 1;
select id, environment, marketplace, refresh_token is null as ohne_token from public.ebay_account;
select has_table_privilege('authenticated', 'public.ebay_account', 'select') as geraet_liest_konto,
       has_table_privilege('authenticated', 'public.ebay_status', 'select') as geraet_liest_status;
```

Erwartet: `ebay_account 24`, `ebay_listings 15`, `ebay_status 19`, `listing_photos 7`; zwei Regeln
(`ebay_listings_authenticated_read`, `listing_photos_authenticated_all`), **keine** Regel für
`ebay_account`; die Speicher-Regel `listing_photos_objects_insert`; Bucket
`listing-photos | true | 2097152 | {image/jpeg}`; zwei Funktionen; eine Kontozeile
`1 | sandbox | EBAY_DE | true`; `geraet_liest_konto = false`, `geraet_liest_status = true`.

## 2. eBay-Entwicklerkonto (RuName)

developer.ebay.com, je Umgebung: Keyset (App ID = Client ID, Cert ID = Client Secret) und unter
„User Tokens › Get a Token from eBay via Your Application“ eine **RuName** anlegen mit
- *Your auth accepted URL*: `https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-auth?action=callback`
- *Your auth declined URL*: `https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-auth?action=declined`
- *Privacy Policy URL*: beliebige eigene Seite (Pflichtfeld bei eBay).

Die Adresse `…/ebay-auth?action=callback` (bzw. `?action=declined`) kann so bleiben, obwohl sie schon
ein `?` enthält: hängt eBay seine Parameter mit einem zweiten `?` statt mit `&` an
(`…?action=callback?state=…&code=…`), löst die Funktion sie trotzdem richtig heraus. Jeder Aufruf
mit `code`, `state` oder `error` in der Adresse gilt als Rücksprung, egal was in `action` steht.

**Geschäftsrichtlinien im Sandbox-Verkäuferkonto:** Im eBay-Sandbox-Verkäuferkonto (bzw. später im
echten Konto) müssen die Geschäftsrichtlinien (*Business Policies*, Programm
`SELLING_POLICY_MANAGEMENT`) aktiviert sein, und es muss je eine **Zahlungs-, Versand- und
Rücknahme-Richtlinie** angelegt sein — sonst bleibt der Check in der App rot und keine Anzeige wird
eingestellt. Bei der Abnahme außerdem die Adresse (Artikelstandort mit PLZ und Ort) prüfen.

## 3. Secrets setzen

Platzhalter ersetzen; nie in Dateien oder Chats kopieren:

```bash
supabase secrets set --project-ref uirfqwklvavgjklgqpnn \
  EBAY_SANDBOX_CLIENT_ID=<sandbox-app-id> EBAY_SANDBOX_CLIENT_SECRET=<sandbox-cert-id> EBAY_SANDBOX_RUNAME=<sandbox-runame> \
  EBAY_PROD_CLIENT_ID=<prod-app-id> EBAY_PROD_CLIENT_SECRET=<prod-cert-id> EBAY_PROD_RUNAME=<prod-runame> \
  EBAY_CRON_SECRET=<zufallswert-mind-32-zeichen>
```

Die Produktions-Werte dürfen zunächst fehlen; `ebay-auth start` meldet dann „eBay-Zugangsdaten für
Produktion fehlen (Secrets EBAY_PROD_…).“ `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` (Deals-Scraper)
bleiben unberührt.

## 4. Deploy

Beide mit `--no-verify-jwt`; die Funktionen prüfen das JWT selbst, der eBay-Rücksprung und der
Zeitplan kommen ohne Anmeldung:

```bash
supabase functions deploy ebay-auth --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
supabase functions deploy ebay-sync --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
```

## 5. Zeitplan (alle 5 Minuten)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('ebay-sync', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-sync',
    headers := '{"Content-Type": "application/json", "x-ebay-secret": "<zufallswert-mind-32-zeichen>"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
```

Prüfen: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'ebay-sync') order by start_time desc limit 5;`
und `select last_run_at, last_run_summary, last_error from public.ebay_status;`.
Abschalten: `select cron.unschedule('ebay-sync');`.

Jeder Lauf hat ein Zeitbudget von rund 60 Sekunden, jeder einzelne eBay-Aufruf ein Zeitlimit von
20 Sekunden; was in dieser Zeit nicht fertig wird, holt der nächste 5-Minuten-Lauf nach. Eine Abgleich-Sperre (`ebay_try_lock`) verhindert für 300 Sekunden
einen zweiten gleichzeitigen Lauf; endet ein Lauf, ohne sie freizugeben, läuft die Sperre nach 300
Sekunden von selbst ab.

## 6. Von Hand testen (nur der Nutzer)

In der App: Einstellungen › eBay › Verbinden (Sandbox) → Browser zeigt „Verbunden – du kannst das
Fenster schließen.“ → Prüfen → Check grün.

```bash
curl -s -X POST https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-sync -H "x-ebay-secret: <zufallswert-mind-32-zeichen>"
```
→ `{"ok":true,"busy":false,…,"text":"0 eingestellt · 0 geändert · 0 beendet · 0 Fehler"}` bzw. bei
einem noch laufenden Durchgang `{"ok":true,"busy":true,"text":"läuft schon"}`.

Zusätzlich: ein echtes Hochformat-Handyfoto einmal über den PC und einmal über das Handy hochladen
und danach auf eBay prüfen, ob es dort richtig herum steht.

## 7. Sandbox → Produktion

Zuerst alle Sandbox-Angebote beenden — sonst verweigert die App den Wechsel („Zuerst die n
eBay-Anzeigen in der Sandbox beenden – sonst bleiben sie dort online.“). Dann Umgebung auf
„Produktion“ stellen, neu verbinden, Check, und ein echtes Angebot einstellen.

## 8. Was wo steht

- Tokens stehen ausschließlich in `ebay_account` — dafür gibt es absichtlich keine Regel, kein
  Gerät liest diese Tabelle. Geräte lesen nur `ebay_status`.
- Die Rücksprung-Seite (nach dem eBay-Login) ist reiner Text, kein HTML — Supabase schreibt
  `text/html` auf der Standard-Domain zu `text/plain` um.
- Fehlersuche: `supabase functions logs ebay-sync` (keine Tokens in den Protokollen).
- Eine abgelaufene Verbindung zeigt „Verbindung abgelaufen – bitte neu verbinden“.
- Meldet der Check „Secrets prüfen“, sind Client-ID oder Client-Secret falsch gesetzt (eBay
  antwortet `invalid_client`) — das ist kein Zeichen einer abgelaufenen Verbindung, sondern ein
  Tippfehler in Schritt 3.

**Sicherheit:** In den Supabase-Projekteinstellungen (Authentication) müssen „Allow new users to
sign up“ **und** die anonyme Anmeldung ausgeschaltet sein. Die eBay-Funktionen akzeptieren jede
gültige Anmeldung dieses Projekts (Einzelnutzer-Modell) — ohne diese beiden Schalter könnte sich
ein Fremder selbst ein Konto anlegen und ebenfalls Zugriff auf die eBay-Funktionen bekommen.

## 9. Risiken

- Ändern sich eBays Pflichtmerkmale einer Kategorie, geht die betroffene Anzeige beim nächsten
  Lauf auf „fehler“ (eBays Meldung steht dann im Angebot).
- Konvolut-Kategorie: Einzelkarten laufen unter `183454` (mit Zustandsbeschreibung, Deskriptor
  `40001`), Konvolute unter `183455` „Sammlungen & Lots“ (ohne Zustandsbeschreibung — eBay listet
  den Deskriptor dort nicht); ob eBay `USED_VERY_GOOD` in `183455` auch ohne Deskriptor annimmt,
  prüft die Sandbox-Abnahme.
- Die Sandbox-Anzeigen-Adresse `https://sandbox.ebay.de/itm/<id>` ist ungeprüft; ist sie falsch,
  ändert sich nur `itemUrl` in `ebay-map.ts`.
- Foto-Adressen (`listing-photos`-Bucket) sind öffentlich lesbar, wie von eBay verlangt.
