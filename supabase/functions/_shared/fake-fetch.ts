// supabase/functions/_shared/fake-fetch.ts -- NUR für Tests: nachgebautes HTTP ohne Netz.
// routes: "METHOD https://host/pfad?query" (genau) oder "METHOD https://host/pfad" (ohne Query) -> Antwort oder Funktion.
export type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };
export type Reply = { status?: number; body?: unknown } | ((c: Call) => { status?: number; body?: unknown });

export function fakeFetch(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetchFn = (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const c: Call = { method, url, headers, body: typeof init.body === "string" ? init.body : null };
    calls.push(c);
    const r = routes[`${method} ${url}`] ?? routes[`${method} ${url.split("?")[0]}`];
    if (!r) return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: `keine Route ${method} ${url}` }] }), { status: 599 }));
    const x = typeof r === "function" ? r(c) : r;
    const status = x.status ?? 200;
    const text = x.body === undefined ? null : JSON.stringify(x.body);
    return Promise.resolve(new Response(status === 204 ? null : text, { status }));
  };
  return { fetchFn, calls };
}
