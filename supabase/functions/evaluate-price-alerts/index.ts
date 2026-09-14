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
