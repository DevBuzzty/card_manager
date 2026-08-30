# Cloud deal-scraper (Supabase)

Makes the phone's Deals tab autonomous: an Edge Function scrapes on a schedule and writes
new listings to Supabase, so the phone (and desktop) just read from the cloud — no desktop
scraper needed.

## 1. Create the tables

Supabase dashboard → **SQL Editor** → paste and run [`deals_schema.sql`](deals_schema.sql).

## 2. Deploy the Edge Function

Needs the [Supabase CLI](https://supabase.com/docs/guides/cli) once:

```bash
npm install -g supabase
supabase login                       # opens browser
supabase link --project-ref <your-project-ref>   # ref = the subdomain of your project URL
supabase functions deploy scrape-deals --no-verify-jwt
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — no secrets to set.

## 3. THE MAKE-OR-BREAK TEST — does cloud scraping work?

Kleinanzeigen may block datacenter IPs. Test before wiring up the rest.

First insert one test watch (SQL Editor — replace the email with your login):

```sql
insert into deal_watches (user_id, query, max_price)
values ((select id from auth.users where email = 'YOUR_LOGIN_EMAIL'), 'yu-gi-oh battles of legend', 200);
```

Then invoke the function manually:

```bash
curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/scrape-deals" \
  -H "Authorization: Bearer <your-anon-key>"
```

Read the JSON response:

- `"scanned": <number > 0>` → **cloud scraping works.** Proceed to step 4.
- `"scanned": 0` (with an active watch that has real results) → the cloud IP is blocked.
  Check `supabase functions logs scrape-deals` for `HTTP 403`. If blocked, we fall back to
  scraping from the phone/desktop and using the cloud only as the shared store.

## 4. Schedule it (every 15 min)

SQL Editor — enable pg_cron + pg_net once, then schedule:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('scrape-deals', '*/15 * * * *', $$
  select net.http_post(
    url    := 'https://<project-ref>.supabase.co/functions/v1/scrape-deals',
    headers:= '{"Authorization": "Bearer <your-anon-key>"}'::jsonb
  );
$$);
```

## Next steps (not yet built)

- Phone reads `deal_watches` / `deal_alerts` from Supabase and adds watches there (autonomous).
- Background push when the app is closed → FCM (separate setup). Until then, Supabase Realtime
  gives live updates while the app is open.
