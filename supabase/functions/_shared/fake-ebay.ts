// supabase/functions/_shared/fake-ebay.ts -- NUR für Tests: nachgebautes eBay (Token, Taxonomy, Inventory) im Speicher.
import type { AspectDef } from "./ebay-map.ts";

type FakeOffer = {
  offerId: string; sku: string; marketplaceId: string; status: "PUBLISHED" | "UNPUBLISHED"; body: any;
  listing?: { listingId: string; listingStatus: string; soldQuantity: number };
};
export type FakeEbayOpts = {
  aspects?: AspectDef[]; rejectPublish?: Record<string, string>; down?: boolean; publishDown?: boolean;
  refreshInvalid?: boolean; codeInvalid?: boolean;
  programs?: string[]; payment?: { id: string; name: string }[]; fulfillment?: { id: string; name: string }[];
  returns?: { id: string; name: string }[]; locations?: { key: string; name: string }[];
};

export function fakeEbay(opts: FakeEbayOpts = {}) {
  const items = new Map<string, any>();
  const offers = new Map<string, FakeOffer>();
  const calls: { method: string; url: string; body: string | null; auth: string | null }[] = [];
  let n = 0;
  const reply = (status: number, body?: unknown) =>
    Promise.resolve(new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status }));
  const fetchFn = (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : null;
    calls.push({ method, url, body, auth: new Headers(init.headers).get("authorization") });
    if (opts.down) return reply(503, { errors: [{ message: "Service Unavailable" }] });
    const u = new URL(url);
    const p = u.pathname;
    if (p === "/identity/v1/oauth2/token") {
      const f = new URLSearchParams(body ?? "");
      if (f.get("grant_type") === "client_credentials") return reply(200, { access_token: "APP", expires_in: 7200 });
      if (f.get("grant_type") === "authorization_code") {
        return opts.codeInvalid ? reply(400, { error: "invalid_grant", error_description: "code expired" })
          : reply(200, { access_token: "AT", expires_in: 7200, refresh_token: "RT", refresh_token_expires_in: 47304000 });
      }
      if (opts.refreshInvalid) return reply(400, { error: "invalid_grant", error_description: "refresh token is invalid" });
      return reply(200, { access_token: "AT2", expires_in: 7200 });
    }
    if (p === "/commerce/taxonomy/v1/get_default_category_tree_id") return reply(200, { categoryTreeId: "77" });
    if (p === "/commerce/taxonomy/v1/category_tree/77/get_item_aspects_for_category") return reply(200, { aspects: opts.aspects ?? [] });
    const pol = (list: { id: string; name: string }[] | undefined, def: string, key: string) =>
      (list ?? [{ id: def, name: `Richtlinie ${def}` }]).map((x) => ({ [key]: x.id, name: x.name }));
    if (p === "/sell/account/v1/program/get_opted_in_programs") {
      return reply(200, { programs: (opts.programs ?? ["SELLING_POLICY_MANAGEMENT"]).map((programType) => ({ programType })) });
    }
    if (p === "/sell/account/v1/payment_policy") return reply(200, { paymentPolicies: pol(opts.payment, "PAY1", "paymentPolicyId") });
    if (p === "/sell/account/v1/fulfillment_policy") return reply(200, { fulfillmentPolicies: pol(opts.fulfillment, "FUL1", "fulfillmentPolicyId") });
    if (p === "/sell/account/v1/return_policy") return reply(200, { returnPolicies: pol(opts.returns, "RET1", "returnPolicyId") });
    if (p === "/sell/inventory/v1/location" && method === "GET") {
      return reply(200, { locations: (opts.locations ?? []).map((l) => ({ merchantLocationKey: l.key, name: l.name, merchantLocationStatus: "ENABLED" })) });
    }
    const loc = p.match(/^\/sell\/inventory\/v1\/location\/(.+)$/);
    if (loc && method === "POST") {
      opts.locations = [...(opts.locations ?? []), { key: decodeURIComponent(loc[1]), name: JSON.parse(body!).name }];
      return reply(204);
    }
    let m = p.match(/^\/sell\/inventory\/v1\/inventory_item\/(.+)$/);
    if (m && method === "PUT") { items.set(decodeURIComponent(m[1]), JSON.parse(body!)); return reply(204); }
    if (p === "/sell/inventory/v1/offer" && method === "GET") {
      const list = [...offers.values()].filter((o) => o.sku === u.searchParams.get("sku"));
      return list.length ? reply(200, { offers: list.map(view) }) : reply(404, { errors: [{ errorId: 25713, message: "not found" }] });
    }
    if (p === "/sell/inventory/v1/offer" && method === "POST") {
      const b = JSON.parse(body!);
      const offerId = `O${++n}`;
      offers.set(offerId, { offerId, sku: b.sku, marketplaceId: b.marketplaceId, status: "UNPUBLISHED", body: b });
      return reply(201, { offerId });
    }
    m = p.match(/^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/);
    if (m) {
      const o = offers.get(m[1]);
      if (!o) return reply(404, { errors: [{ errorId: 25713, message: "offer not found" }] });
      if (!m[2] && method === "GET") return reply(200, view(o));
      if (!m[2] && method === "PUT") { o.body = JSON.parse(body!); return reply(204); }
      if (m[2] === "/publish") {
        if (opts.publishDown) return reply(503, { errors: [{ message: "Service Unavailable" }] });
        const why = opts.rejectPublish?.[o.sku];
        if (why) return reply(400, { errors: [{ errorId: 25002, longMessage: why }] });
        o.status = "PUBLISHED";
        o.listing = { listingId: `I${++n}`, listingStatus: "ACTIVE", soldQuantity: 0 };
        return reply(200, { listingId: o.listing.listingId });
      }
      if (m[2] === "/withdraw") { o.status = "UNPUBLISHED"; delete o.listing; return reply(200, { offerId: o.offerId }); }
    }
    return reply(599, { errors: [{ message: `keine Route ${method} ${url}` }] });
  };
  const view = (o: FakeOffer) => ({ offerId: o.offerId, sku: o.sku, marketplaceId: o.marketplaceId, status: o.status, listing: o.listing });
  const ebayCalls = () => calls.filter((c) => c.url.includes("/sell/"));
  return { fetchFn, calls, ebayCalls, items, offers };
}
