// Spec H3b §8/§9 -- Zugang zu ebay-sync: Zeitplan nur mit Geheimwert, sonst Anmeldung; retry nur vom Gerät.
import { assertEquals } from "jsr:@std/assert@1";
import { handleSync } from "./handler.ts";

const FN = "https://proj.supabase.co/functions/v1/ebay-sync";
function deps(cronSecret: string | undefined) {
  const runs: (string | null)[] = [];
  return {
    runs,
    d: {
      cronSecret, verifyUser: (h: string | null) => Promise.resolve(h === "Bearer JWT"),
      run: (retry: string | null) => { runs.push(retry); return Promise.resolve({ ok: true as const, busy: true as const, text: "läuft schon" }); },
    },
  };
}
const req = (headers: Record<string, string>, body: unknown = {}) => new Request(FN, { method: "POST", headers, body: JSON.stringify(body) });

Deno.test("Zeitplan mit richtigem Geheimwert läuft, retry wird ignoriert", async () => {
  const x = deps("s3cret");
  const r = await handleSync(req({ "x-ebay-secret": "s3cret" }, { retry: "l1" }), x.d);
  assertEquals([r.status, x.runs], [200, [null]]);
});

Deno.test("falscher oder fehlender Geheimwert ohne Anmeldung -> 401; ohne EBAY_CRON_SECRET nie offen", async () => {
  for (const [secret, h] of [["s3cret", { "x-ebay-secret": "falsch" }], [undefined, { "x-ebay-secret": "" }], [undefined, {}]] as const) {
    const x = deps(secret);
    assertEquals((await handleSync(req(h as Record<string, string>), x.d)).status, 401);
    assertEquals(x.runs.length, 0);
  }
});

Deno.test("angemeldetes Gerät: Anstoß und Erneut versuchen", async () => {
  const x = deps("s3cret");
  await handleSync(req({ Authorization: "Bearer JWT" }), x.d);
  await handleSync(req({ Authorization: "Bearer JWT" }, { retry: "l7" }), x.d);
  assertEquals(x.runs, [null, "l7"]);
  assertEquals((await handleSync(new Request(FN), x.d)).status, 405);
});

// Fixrunde 1 (Task 5) Minor 6: kaputtes JSON, `null`, ein Array oder ein Primitiv als Body zählen wie leer --
// kein roher Absturz, `retry` bleibt einfach unbeachtet/null.
Deno.test("kaputter oder kein Objekt als Body -> wie leer behandelt, kein Absturz", async () => {
  const x = deps("s3cret");
  const raw = (body: string) => new Request(FN, { method: "POST", headers: { "x-ebay-secret": "s3cret" }, body });
  for (const body of ["null", "[1,2]", "\"text\"", "", "{kaputt"]) {
    const r = await handleSync(raw(body), x.d);
    assertEquals(r.status, 200);
  }
  assertEquals(x.runs, [null, null, null, null, null]);
});
