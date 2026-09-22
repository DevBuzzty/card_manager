// supabase/functions/_shared/ebay-map.ts
// Spec H3b §5.2/§5.3 -- reine Abbildung Angebot -> eBay-Inventar-Artikel/Offer, Prüfsumme, Zustand, Merkmale, Bilder.
// Keine Netz- oder Datenbankzugriffe (Tests: ebay-map_test.ts gegen docs/fixtures/ebay/map.json).
// Titel/Beschreibung/Stückpreis aus dem Deno-Zwilling listing-text.ts (Regeln aus H3a).
import { groupItems, LANGUAGE_NAMES, type LineItem, listingDescription, listingTitle, pieceCents } from "./listing-text.ts";

export const MARKETPLACE = "EBAY_DE";
export const CATEGORY_ID = "183454";      // Einzelkarten (Nutzer 22.09.: Konvolute in 183455)
export const CATEGORY_LOTS = "183455";    // „Sammlungen & Lots“ (Befund Doku 15)
export const EBAY_TITLE_MAX = 80;
export const MAX_IMAGES = 24;
export const MAX_OWN_PHOTOS = 12;
export const PHOTO_BUCKET = "listing-photos";
// Inventory API ConditionEnum fuer Condition-ID 4000 = „Ungraded“ in den Sammelkarten-Kategorien (Befund eBay-Doku 6).
export const CONDITION_UNGRADED = "USED_VERY_GOOD";
export const CARD_CONDITION_DESCRIPTOR = "40001";
// CCG-Werte (Befund eBay-Doku 7): 400010 Near mint or better, 400015 Lightly played (Excellent),
// 400016 Moderately played (Very good), 400017 Heavily played (Poor).
export const CARD_CONDITION_VALUE: Record<string, string> = {
  MT: "400010", NM: "400010", EX: "400015", GD: "400016", LP: "400016", PL: "400017", PO: "400017",
};
const CONDITION_ORDER = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
const LANGUAGE_EN: Record<string, string> = {
  DE: "German", EN: "English", FR: "French", IT: "Italian", SP: "Spanish", PT: "Portuguese", JP: "Japanese",
};

export type SollListing = {
  listing_id: string; channel_id: string; title: string | null; description: string | null;
  price: number | string; status: string; deleted: boolean;
};
export type SollItem = LineItem & { listing_id: string; deleted: boolean };
export type Photo = { photo_id: string; listing_id: string; path: string; sort: number; deleted: boolean };
export type AspectDef = {
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; itemToAspectCardinality?: string };
  aspectValues?: { localizedValue: string }[];
};
export type Policies = {
  payment_policy_id: string | null; fulfillment_policy_id: string | null; return_policy_id: string | null;
  location_key: string | null;
};
export type Built = {
  sku: string; kind: "gleich" | "konvolut"; quantity: number; totalCents: number; pieceCents: number;
  title: string; descriptionHtml: string; condition: string; conditionValue: string; imageUrls: string[];
  aspects: Record<string, string[]>; missing: string[]; problem: string | null; categoryId: string;
};

// Abweichung 10: Konvolut (mehrere Drucke) -> Kategorie 183455, sonst 183454. Vor buildListing aufrufbar, damit der
// Abgleicher die Pflichtmerkmale der richtigen Kategorie laden kann.
export function categoryFor(liveItems: SollItem[]): string {
  return groupItems(liveItems).length === 1 ? CATEGORY_ID : CATEGORY_LOTS;
}

const blank = (v: string | null | undefined) => v == null || v.trim() === "";
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const toCents = (v: number | string) => Math.round(Number(v) * 100);
export const skuOf = (listingId: string) => `L-${listingId}`;

// Spec §5.3 Soll: Angebot auf Kanal ebay, Status aktiv, nicht gelöscht, mit mindestens einer lebenden Position,
// deren Exemplar lebt (liveCopyIds = card_copies deleted = false und sold_in is null). Positionen nach copy_id.
export function desired(listing: SollListing | null, items: SollItem[], liveCopyIds: Set<string>) {
  if (!listing) return { active: false, liveItems: [] as SollItem[] };
  const liveItems = items
    .filter((it) => it.listing_id === listing.listing_id && !it.deleted && liveCopyIds.has(it.copy_id))
    .sort((a, b) => cmp(a.copy_id, b.copy_id));
  const active = listing.channel_id === "ebay" && listing.status === "aktiv" && !listing.deleted && liveItems.length > 0;
  return { active, liveItems };
}

// Öffentliche Adresse eines Fotos im Speicher (Bucket öffentlich lesbar, Spec §6). Pfad-Teile einzeln kodiert.
export function photoUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
// Eigene Fotos eines Angebots in Reihenfolge (sort, dann photo_id), höchstens 12, gelöschte nicht.
export function ownPhotos(photos: Photo[], listingId: string): Photo[] {
  return photos.filter((p) => p.listing_id === listingId && !p.deleted)
    .sort((a, b) => a.sort - b.sort || cmp(a.photo_id, b.photo_id)).slice(0, MAX_OWN_PHOTOS);
}

// Spec §5.2 Bilder: eigene Fotos (Reihenfolge), danach Katalogbild je Druck (Gruppenreihenfolge wie H3a), nur https,
// ohne Doppelte, höchstens 24.
export function imageList(photoUrls: string[], liveItems: LineItem[]): string[] {
  const out: string[] = [];
  for (const u of [...photoUrls, ...groupItems(liveItems).map((g) => g.image_url)]) {
    if (typeof u !== "string" || !/^https:\/\//i.test(u) || out.includes(u)) continue;
    out.push(u);
    if (out.length === MAX_IMAGES) break;
  }
  return out;
}

// Konvolut: schlechtester Zustand (höchster Index in MT…PO); unbekannte Kennungen zählen als NM.
export function worstCondition(items: LineItem[]): string {
  let worst = "NM";
  for (const it of items) {
    const i = CONDITION_ORDER.indexOf(it.condition);
    if (i > CONDITION_ORDER.indexOf(worst)) worst = it.condition;
  }
  return worst;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function descriptionHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
}

// Merkmal-Namen (klein, getrimmt) -> Begriff. eBay.de liefert die Namen lokalisiert; die englischen stehen als
// Rückfall (Sandbox). Unbekannte Namen bleiben leer; sind sie Pflicht, stehen sie in missing (Spec §5.2).
const CONCEPT_BY_NAME: Record<string, string> = {
  "spiel": "game", "game": "game",
  "hersteller": "manufacturer", "manufacturer": "manufacturer",
  "kartenname": "cardName", "card name": "cardName",
  "set": "set",
  "seltenheit": "rarity", "rarität": "rarity", "rarity": "rarity",
  "sprache": "language", "language": "language",
  "besonderheiten": "features", "features": "features", "merkmale": "features",
};
const knownValue = (v: string | null | undefined) => v != null && v !== "" && v !== "Unknown";
function distinct(list: string[]): string[] {
  const out: string[] = [];
  for (const v of list) if (!out.includes(v)) out.push(v);
  return out;
}
// Je Begriff eine Liste von Werten; jeder Wert ist eine Liste gleichwertiger Schreibweisen (erste = bevorzugt).
export function aspectCandidates(liveItems: LineItem[]): Record<string, string[][]> {
  const groups = groupItems(liveItems);
  return {
    game: [["Yu-Gi-Oh! TCG"]],
    manufacturer: [["Konami"]],
    cardName: distinct(groups.map((g) => (g.name != null && g.name !== "" ? g.name : g.card_id))).map((v) => [v]),
    set: distinct(groups.map((g) => g.set_code).filter(knownValue)).map((v) => [v]),
    rarity: distinct(groups.map((g) => g.rarity).filter(knownValue)).map((v) => [v]),
    language: distinct(groups.map((g) => g.language)).filter((l) => LANGUAGE_NAMES[l])
      .map((l) => [LANGUAGE_NAMES[l], LANGUAGE_EN[l]]),
    features: groups.some((g) => g.edition === "first") ? [["1. Auflage", "1st Edition"]] : [],
  };
}
function matchAllowed(alts: string[], allowed: { localizedValue: string }[] | undefined): string | null {
  for (const a of alts) {
    const hit = (allowed || []).find((v) => v.localizedValue.toLowerCase() === a.toLowerCase());
    if (hit) return hit.localizedValue;
  }
  return null;
}
export function fillAspects(defs: AspectDef[], liveItems: LineItem[]) {
  const cand = aspectCandidates(liveItems);
  const aspects: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const d of defs || []) {
    const name = d.localizedAspectName;
    const concept = CONCEPT_BY_NAME[name.trim().toLowerCase()];
    const c = d.aspectConstraint || {};
    const multi = c.itemToAspectCardinality === "MULTI";
    const values: string[] = [];
    for (const alts of concept ? cand[concept] : []) {
      const v = c.aspectMode === "SELECTION_ONLY" ? matchAllowed(alts, d.aspectValues) : alts[0];
      if (v != null && !values.includes(v)) values.push(v);
      if (!multi && values.length > 0) break;
    }
    if (values.length > 0) aspects[name] = values;
    else if (c.aspectRequired) missing.push(name);
  }
  return { aspects, missing };
}
export const NO_IMAGE = "Kein Bild vorhanden – bitte ein eigenes Foto hinzufügen.";
export function missingText(missing: string[]): string {
  return missing.length === 1
    ? `eBay verlangt das Merkmal „${missing[0]}“.`
    : `eBay verlangt die Merkmale ${missing.map((m) => `„${m}“`).join(", ")}.`;
}

// Spec §5.2: gleiche Karten -> Menge n, Stückpreis = pieceCents(Preis, n); Konvolut -> Menge 1, Gesamtpreis.
// Titel: Angebotstitel, leer -> H3a-Titelregel; höchstens 80. Beschreibung: Angebotstext, leer -> H3a-Beschreibung.
export function buildListing(
  listing: SollListing, liveItems: SollItem[], photoUrls: string[], defs: AspectDef[],
): Built {
  const totalCents = toCents(listing.price);
  const same = groupItems(liveItems).length === 1;
  const quantity = same ? liveItems.length : 1;
  const condition = worstCondition(liveItems);
  const title = (blank(listing.title) ? listingTitle(liveItems) : listing.title!.trim()).slice(0, EBAY_TITLE_MAX).trimEnd();
  const text = blank(listing.description) ? listingDescription(liveItems, totalCents) : listing.description!;
  const { aspects, missing } = fillAspects(defs, liveItems);
  const imageUrls = imageList(photoUrls, liveItems);
  // Vor jedem eBay-Aufruf prüfbar: eBay veröffentlicht nur mit mindestens einem Bild und allen Pflichtmerkmalen.
  const problem = imageUrls.length === 0 ? NO_IMAGE : missing.length > 0 ? missingText(missing) : null;
  return {
    sku: skuOf(listing.listing_id), kind: same ? "gleich" : "konvolut", quantity, totalCents,
    pieceCents: same ? pieceCents(totalCents, quantity) : totalCents, title, descriptionHtml: descriptionHtml(text),
    condition, conditionValue: CARD_CONDITION_VALUE[condition], imageUrls, aspects, missing, problem,
    categoryId: same ? CATEGORY_ID : CATEGORY_LOTS,
  };
}

const money = (cents: number) => ({ value: (cents / 100).toFixed(2), currency: "EUR" });

export function inventoryItemBody(b: Built) {
  return {
    availability: { shipToLocationAvailability: { quantity: b.quantity } },
    condition: CONDITION_UNGRADED,
    // Kartenzustand-Deskriptor nur in der Einzelkarten-Kategorie (eBay listet ihn für 183050/183454/261328, nicht für 183455).
    ...(b.categoryId === CATEGORY_ID ? { conditionDescriptors: [{ name: CARD_CONDITION_DESCRIPTOR, values: [b.conditionValue] }] } : {}),
    product: { title: b.title, description: b.descriptionHtml, aspects: b.aspects, imageUrls: b.imageUrls },
  };
}
export function offerBody(b: Built, p: Policies) {
  return {
    sku: b.sku, marketplaceId: MARKETPLACE, format: "FIXED_PRICE", availableQuantity: b.quantity,
    categoryId: b.categoryId, listingDescription: b.descriptionHtml, listingDuration: "GTC",
    listingPolicies: {
      fulfillmentPolicyId: p.fulfillment_policy_id, paymentPolicyId: p.payment_policy_id, returnPolicyId: p.return_policy_id,
    },
    merchantLocationKey: p.location_key, pricingSummary: { price: money(b.pieceCents) },
  };
}

// Spec §5.3 Prüfsumme über Titel, Text, Preis, Menge, Zustand, Bilder (SHA-256, hex).
export async function hashOf(b: Built): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify([b.title, b.descriptionHtml, b.pieceCents, b.quantity, b.conditionValue, b.imageUrls]),
  );
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Link der Anzeige je Umgebung (Befund eBay-Doku 12: Sandbox-Adresse ist bei der Abnahme zu prüfen).
export function itemUrl(env: string, itemId: string): string {
  return env === "production" ? `https://www.ebay.de/itm/${itemId}` : `https://sandbox.ebay.de/itm/${itemId}`;
}
