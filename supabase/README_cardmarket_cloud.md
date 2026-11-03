# Cardmarket cloud price refresh

Keeps `cards.price` current on the phone even when the desktop is off. The desktop still owns the
`cm_product_id` mapping (file resolver + scraper); the cloud only applies Cardmarket's daily `trend`.
Design: `docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md`.

## 1. Apply the SQL (once, BEFORE the desktop mirrors the new columns)

SQL editor → paste `supabase/cardmarket_cloud_prices_migration.sql` → Run.
Check: `select column_name, data_type from information_schema.columns where table_name = 'cards' and column_name in ('cm_product_id','price_locked');`
→ `cm_product_id integer`, `price_locked smallint`.
If a desktop with the new sync code runs before this SQL is applied, its push fails wholesale
(`column cards.cm_product_id does not exist` / `invalid input syntax for type boolean`) and ALL
card sync pauses; it resumes by itself once the SQL has run.

## 2. Deploy the Edge Function

```bash
supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
Optional hardening: `supabase secrets set CM_TRIGGER_SECRET=<random> --project-ref uirfqwklvavgjklgqpnn`
— then every caller (cron included) must send header `x-cm-secret: <random>`.

## 3. Test it by hand

```bash
curl -s -X POST https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices
```
→ `{"needed":<n>,"found":<n>,"updated":<k>}`. `needed` = distinct `cm_product_id`s in the cloud
(0 until the desktop has pushed the backfill), `found` = ids present in today's guide with a
positive trend, `updated` = rows whose price actually changed (0 when the desktop already priced
them today — that is the expected idempotent result).

## 4. Schedule it (daily 05:00 UTC; Cardmarket rewrites the file ~00:45 UTC)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('refresh-cardmarket-prices', '0 5 * * *', $$
  select net.http_post(
    url     := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
```
If you set `CM_TRIGGER_SECRET`, add `"x-cm-secret": "<random>"` to the headers object.
Inspect runs: `select * from cron.job_run_details order by start_time desc limit 5;`
Unschedule: `select cron.unschedule('refresh-cardmarket-prices');`

## How it converges with the desktop

Cloud writes `trend` → desktop pull only applies quantity/deleted (no-op). Desktop bulk computes
the same `trend` → its "only if changed" guard skips the row → nothing is pushed. Manual prices
(`price_locked = 2`) are skipped everywhere.
Prices are per Cardmarket product (`cm_product_id`), i.e. per printing+rarity as resolved on the
desktop; the cloud never changes the mapping.

## Spec A (2026-09): price history

`apply_cardmarket_prices` now also upserts one `price_history` row (source `cloud`, variant `base`, today) per card whose price changed.

**Apply order (on a fresh project):**
1. `portfolio_snapshots_schema.sql` (if not yet applied)
2. `card_copies_schema.sql`
3. `price_history_schema.sql`

The desktop backfills copies and pushes them on its next sync.

**Rollout order:** apply the cloud SQL first (steps 1-3 above), then run the updated desktop
build — it backfills `card_copies` locally and pushes them on its next sync — then install the
updated phone build. An old phone build still PATCHes `cards.quantity` directly; the new desktop
and cloud triggers simply ignore that field, so an out-of-order phone update is harmless, just
inert until the phone is updated too.

**Restoring an old backup:** restoring a pre-Spec-A `cards.db` (no `card_copies` rows) makes the
desktop re-run the backfill on next launch. If the cloud already holds copies for that
collection (e.g. sync had already delivered the Spec A migration before the restore), the next
pull would double them up. Restore only with sync disabled, and clear `card_copies` in the cloud
first — or ask for a reconcile before re-enabling sync.

## cm-index und resolve-cm-product (Spec 2026-11-03 §5, §11)

Druckgenaue Cardmarket-Zuordnung auf Abruf für die Ergebnis-Seite des Handys (Einzelmodus). Ein eigener Schritt von
`refresh-cardmarket-prices` baut täglich einen kompakten Index (`cm-index.json.gz`, privater Bucket `cm-index`); die neue
Funktion `resolve-cm-product` löst damit Drucke ohne bzw. mit mehrdeutiger `cm` auf und liefert die Trends aus
`catalog/cm-prices.json.gz` mit. Sie schreibt **nie** in `cards.cm_product_id`; der Desktop bleibt dort der einzige Schreiber.
Agents deployen nicht und spielen kein SQL ein -- das machst du, in dieser Reihenfolge:

1. **SQL:** SQL-Editor → `supabase/cm_resolve_schema.sql` einfügen → Run (Tabelle `cm_resolve_cache`, Trigger, RLS ohne Policy,
   privater Bucket `cm-index`). Voraussetzung: `public.set_updated_at()` aus `schema.sql`.
   Prüfen: `select id, public from storage.buckets where id = 'cm-index';` → `cm-index | false`.
2. **Index-Bau deployen und einmal von Hand bauen:**
   ```bash
   supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
   ```
   ```sql
   select net.http_post(url := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/refresh-cardmarket-prices',
     headers := '{"Content-Type": "application/json", "x-cm-secret": "<geheimnis>"}'::jsonb,
     body := '{"step": "cm-index"}'::jsonb, timeout_milliseconds := 150000);
   ```
   (`x-cm-secret` nur, wenn `CM_TRIGGER_SECRET` gesetzt ist; sonst den Eintrag weglassen.)
   Ergebnis nach ~1 min: `select status_code, content from net._http_response order by created desc limit 1;` →
   `{"step":"cm-index","cmIndex":{"date":…,"names":≈14600,"prefixes":…,"singles":≈87000,"real":…,"catalog":false,"bytes":…}}`.
   Prüfen: Storage → Bucket `cm-index` → `cm-index.json.gz` mit heutigem Änderungsdatum; Function-Logs zeigen je Phase eine Zeile
   `[cm-index] cardsets|nonsingles|singles|real|katalog|upload`. Bei einem Fehler nennt der Body `cmIndex.error` die Phase,
   und der Index vom Vortag bleibt liegen. **Abnahmepunkt:** Die Phase `cardsets` (YGOPRODeck aus Supabase) muss gelingen --
   schlägt sie fehl, bitte melden.
   Der normale 05:00-Lauf (Body `{}`) ist unverändert und baut keinen Index. Ein unbekannter `step` ergibt 400 `unknown step`.
   Optional: Secret `CM_INDEX_KATALOG=1` nimmt die Einzel-`cm` des Katalogs als zusätzliche Stichproben für die Block-Regel
   (sonst nur echte IDs der Cloud-Sammlung).
3. **Funktion deployen:**
   ```bash
   supabase functions deploy resolve-cm-product --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
   ```
   Keine neuen Secrets (die Funktion prüft das Nutzer-JWT selbst). Ein neu gebauter Index wird in warmen Instanzen erst nach
   bis zu 1 h sichtbar (Modulspeicher); zum Testen genügt ein erneuter Deploy. Ohne Index antwortet sie 503 `no_index`
   („Cardmarket-Index fehlt.“), fehlt nur die Preisdatei, kommt `price_date: null`.
4. **Zeitplan:** `supabase/cm_index_cron.sql` einspielen (Job `refresh-cardmarket-cm-index`, täglich 05:20 UTC,
   Platzhalter `<geheimnis>` ersetzen oder die Zeile entfernen). Überwachung über das Änderungsdatum der Storage-Datei bzw.
   die Function-Logs; `cron.job_run_details` zeigt nur, ob der Aufruf abgeschickt wurde.
5. **Optional, gelegentlich aufräumen:**
   `delete from public.cm_resolve_cache where updated_at < now() - interval '90 days';`

Ohne Schritt 1-3 läuft die neue APK trotzdem: Die Live-Suche meldet dann „nicht erreichbar“, alle Offline-Stufen funktionieren.
Diagnose im SQL-Editor: `select * from cm_resolve_cache order by updated_at desc limit 20;`
