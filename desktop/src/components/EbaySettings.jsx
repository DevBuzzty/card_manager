import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { todayLocal } from '../utils/today';
import { useEbayData } from '../utils/useEbayData';
import { setupItems, expiryText } from '../utils/ebayMarks';

const KIND_LABEL = { payment: 'Zahlungsrichtlinie', fulfillment: 'Versandrichtlinie', return: 'Rücknahmerichtlinie', location: 'Artikelstandort' };
const SELECT_FIELD = { payment: 'payment_policy_id', fulfillment: 'fulfillment_policy_id', return: 'return_policy_id', location: 'location_key' };
const KIND_ORDER = ['payment', 'fulfillment', 'return', 'location'];

// Spec H3b §4.4 -- Abschnitt „eBay“: Umgebung, Verbinden/Trennen, Check-Liste, Richtlinien-Auswahl, Standort anlegen,
// „Jetzt abgleichen“, letzter Lauf/Fehler. Alles eBay-Wissen liegt in ebay-auth/ebay-sync (Task 4/5).
export default function EbaySettings() {
  const { status } = useEbayData();
  const [gate] = useState(createBusyGate);
  const [today] = useState(() => todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [check, setCheck] = useState(null); // letzte Antwort von check/select/create_location
  const [loc, setLoc] = useState({ postal_code: '', city: '' });

  const run = (fn) => gate.run(async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(e?.message || 'eBay-Aufruf fehlgeschlagen.'); } finally { setBusy(false); }
  });
  const auth = (data, after) => run(async () => {
    const r = await window.api.ebayAuth(data);
    if (!r?.ok) { setError(r?.error || 'eBay-Aufruf fehlgeschlagen.'); return; }
    if (r.payment) setCheck(r);
    after?.(r);
  });
  const connect = () => auth({ action: 'start' }, () => setNotice('Browser geöffnet – nach dem Bestätigen hier „Prüfen“ drücken.'));
  const disconnect = () => {
    if (window.confirm('eBay trennen? Laufende eBay-Anzeigen bleiben online und werden nicht mehr angepasst – beende sie vorher, wenn möglich. Neue eBay-Angebote warten dann.')) {
      auth({ action: 'disconnect' }, () => setCheck(null));
    }
  };
  const switchEnv = (env) => {
    if (!window.confirm('Umgebung wechseln trennt die Verbindung und leert die Einrichtung. Fortfahren?')) return;
    auth({ action: 'set_environment', environment: env }, () => setCheck(null));
  };
  const select = (kind, id) => auth({ action: 'select', [SELECT_FIELD[kind]]: id });
  const createLocation = () => auth({ action: 'create_location', ...loc }, () => setLoc({ postal_code: '', city: '' }));
  const syncNow = () => run(async () => {
    const r = await window.api.ebaySyncNow({});
    if (!r?.ok) { setError(r?.error || 'eBay-Abgleich fehlgeschlagen.'); return; }
    setNotice(r.busy ? 'Abgleich läuft schon.' : `Abgleich fertig: ${r.text}`);
  });

  const card = 'bg-surface border border-line rounded-2xl p-6';
  const envBtn = (active) => `px-3 py-1.5 rounded-lg text-sm border ${active ? 'bg-accent/20 border-accent/50 text-text' : 'bg-bg border-line text-muted hover:text-text'}`;
  const btn = 'px-3 py-2 rounded-lg text-sm bg-surface-2 border border-line text-text hover:border-accent/40 disabled:opacity-50';
  const primaryBtn = 'px-4 py-2 rounded-lg text-sm bg-accent text-accent-fg disabled:opacity-50';
  const field = 'w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm text-text';

  return (
    <div className={card}>
      <div className="flex items-center mb-6 text-accent border-b border-line pb-4">
        <ShoppingBag className="w-6 h-6 mr-2" />
        <h3 className="font-display text-lg text-text">eBay</h3>
      </div>

      {status === undefined && <p className="text-muted">…</p>}

      {status === null && (
        <>
          <p className="text-sm text-bad">eBay-Stand nicht geladen – Cloud-Sync aktiv? ebay_schema.sql eingespielt?</p>
          <button type="button" disabled className={`${btn} mt-4 opacity-50 cursor-not-allowed`}>Jetzt abgleichen</button>
        </>
      )}

      {status && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">Umgebung</label>
            <div className="flex gap-2">
              <button type="button" disabled={busy || status.environment === 'sandbox'} onClick={() => switchEnv('sandbox')} className={envBtn(status.environment === 'sandbox')}>Sandbox</button>
              <button type="button" disabled={busy || status.environment === 'production'} onClick={() => switchEnv('production')} className={envBtn(status.environment === 'production')}>Produktion</button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">Verbindung</label>
            {status.connected ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-text">Verbunden seit {String(status.connected_at || '').slice(0, 10).split('-').reverse().join('.')}</span>
                <button type="button" disabled={busy} onClick={disconnect} className={btn}>Trennen</button>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={connect} className={primaryBtn}>Verbinden</button>
            )}
            {expiryText(status, today) && <p className="text-sm text-warn mt-2">{expiryText(status, today)}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">Einrichtung</label>
            <ul className="space-y-1 mb-3">
              {setupItems(status).map((it) => (
                <li key={it.label} className={`text-sm ${it.ok ? 'text-good' : 'text-bad'}`}>{it.ok ? '✓' : '✗'} {it.label}</li>
              ))}
            </ul>
            {/* Abschluss-Fix C1: nicht an status.connected koppeln -- der Stand kann nach dem Verbinden noch alt sein;
                der Server meldet selbst „Nicht mit eBay verbunden.“ */}
            <button type="button" disabled={busy} onClick={() => auth({ action: 'check' })} className={btn}>Prüfen</button>

            {check && (
              <div className="mt-4 space-y-3">
                {check.programOk === false && (
                  <p className="text-sm text-bad">Geschäftsrichtlinien sind im eBay-Konto nicht aktiviert.</p>
                )}
                {KIND_ORDER.map((kind) => {
                  const k = check[kind];
                  if (!k) return null;
                  if (k.options.length > 1) {
                    return (
                      <label key={kind} className="block text-xs text-muted">{KIND_LABEL[kind]}
                        <select className={field} value={k.selected ?? ''} onChange={(e) => select(kind, e.target.value)}>
                          <option value="">— wählen —</option>
                          {k.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </label>
                    );
                  }
                  if (k.options.length === 0 && kind !== 'location') {
                    return (
                      <p key={kind} className="text-sm text-muted">
                        Keine {KIND_LABEL[kind]} bei eBay – bitte im Verkäuferkonto anlegen.
                        {check.policyPage && (
                          <button type="button" onClick={() => window.api.openListingUrl(check.policyPage)} className={`${btn} ml-2`}>Seite öffnen</button>
                        )}
                      </p>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>

          {status.connected && !status.has_location && (
            <div>
              <label className="block text-sm font-bold text-muted mb-2 uppercase tracking-wider">Standort anlegen</label>
              <div className="flex flex-wrap items-center gap-2">
                {/* Abschluss-Fix B3: PLZ nur Ziffern, höchstens 5; Knopf erst bei genau 5 */}
                <input inputMode="numeric" placeholder="PLZ" maxLength={5} value={loc.postal_code}
                  onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 5); setLoc((l) => ({ ...l, postal_code: v })); }} className={`w-24 ${field}`} />
                <input placeholder="Ort" value={loc.city}
                  onChange={(e) => setLoc((l) => ({ ...l, city: e.target.value }))} className={`w-48 ${field}`} />
                <button type="button" disabled={busy || !/^\d{5}$/.test(loc.postal_code)} onClick={createLocation} className={btn}>Standort anlegen</button>
              </div>
            </div>
          )}

          <div>
            <button type="button" disabled={busy} onClick={syncNow} className={primaryBtn}>Jetzt abgleichen</button>
            {status.last_run_at && (
              <p className="text-sm text-muted mt-2">Letzter Abgleich: {new Date(status.last_run_at).toLocaleString('de-DE')} – {status.last_run_summary}</p>
            )}
            {status.last_error && <p className="text-sm text-bad mt-1">{status.last_error}</p>}
          </div>

          <p className="text-xs text-muted">Solange der Check nicht vollständig ist, bleiben eBay-Angebote auf „wartet“.</p>
        </div>
      )}

      {notice && <p className="text-sm text-good mt-4">{notice}</p>}
      {error && <p className="text-sm text-bad mt-4">{error}</p>}
    </div>
  );
}
