// supabase/functions/ebay-auth/setup.ts
// Spec H3b §4.3/§4.4 -- Einrichtungs-Check rein: je Art (Zahlung, Versand, Rücknahme, Standort) die Auswahl bestimmen.
// Genau eine Möglichkeit -> automatisch; die bisherige Wahl bleibt, solange es sie noch gibt; mehrere -> Auswahl am Gerät.

export type Option = { id: string; name: string };
export type Kind = "payment" | "fulfillment" | "return" | "location";
export const KINDS: Kind[] = ["payment", "fulfillment", "return", "location"];
export type Lists = Record<Kind, Option[]>;
export type Current = Record<Kind, string | null>;
export type Chosen = Partial<Record<Kind, string>>;

export class SetupError extends Error {}

export function pick(options: Option[], current: string | null, chosen: string | undefined): Option | null {
  if (chosen !== undefined) {
    const o = options.find((x) => x.id === chosen);
    if (!o) throw new SetupError("Auswahl gibt es bei eBay nicht mehr – bitte neu prüfen.");
    return o;
  }
  return options.find((x) => x.id === current) ?? (options.length === 1 ? options[0] : null);
}

export function resolveSetup(lists: Lists, current: Current, chosen: Chosen = {}) {
  const sel = {} as Record<Kind, Option | null>;
  for (const k of KINDS) sel[k] = pick(lists[k], current[k], chosen[k]);
  return {
    selected: sel,
    patch: {
      payment_policy_id: sel.payment?.id ?? null, payment_policy_name: sel.payment?.name ?? null,
      fulfillment_policy_id: sel.fulfillment?.id ?? null, fulfillment_policy_name: sel.fulfillment?.name ?? null,
      return_policy_id: sel.return?.id ?? null, return_policy_name: sel.return?.name ?? null,
      location_key: sel.location?.id ?? null,
    },
  };
}

// Seiten im Verkäuferkonto, wenn eine Art fehlt (Risiko: Adressen bei der Abnahme prüfen).
export const POLICY_PAGE: Record<string, string> = {
  production: "https://www.bizpolicy.ebay.de/businesspolicy/manage",
  sandbox: "https://www.bizpolicy.sandbox.ebay.de/businesspolicy/manage",
};

export const PLZ = /^[0-9]{5}$/;
export function locationBody(postalCode: string, city: string) {
  return {
    location: { address: { postalCode, city, country: "DE" } },
    name: "Yu-Gi-Oh Sammlung", merchantLocationStatus: "ENABLED", locationTypes: ["WAREHOUSE"],
  };
}
export function checkLocationInput(postalCode: unknown, city: unknown): string | null {
  if (typeof postalCode !== "string" || !PLZ.test(postalCode.trim())) return "Bitte eine fünfstellige Postleitzahl angeben.";
  if (typeof city !== "string" || city.trim() === "" || city.trim().length > 60) return "Bitte den Ort angeben.";
  return null;
}
