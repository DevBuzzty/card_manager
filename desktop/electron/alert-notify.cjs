// Spec G2 §6.2 — ob und wie der Desktop neue Preis-Alarme meldet. Reiner Helfer (alert-notify.test.cjs).
// `events` sind die offenen Treffer aus der Cloud, `marker` ist das Setting price_alerts_notified_until
// (Text oder null). Der erste Lauf meldet nichts, damit ein neu eingerichteter Desktop nicht alle
// alten Treffer auf einmal ausspielt. Die Marke laeuft nur vorwaerts.
function nextNotification(events, marker) {
  const list = (events || []).filter((e) => Number.isFinite(Number(e.id)));
  const maxId = list.reduce((m, e) => Math.max(m, Number(e.id)), 0);
  const m = marker == null || marker === '' || !Number.isFinite(Number(marker)) ? null : Number(marker);
  if (m == null) return { notify: 'none', event: null, count: 0, marker: maxId };
  const fresh = list.filter((e) => Number(e.id) > m).sort((a, b) => Number(b.id) - Number(a.id));
  const next = Math.max(m, maxId);
  if (fresh.length === 0) return { notify: 'none', event: null, count: 0, marker: next };
  if (fresh.length === 1) return { notify: 'one', event: fresh[0], count: 1, marker: next };
  return { notify: 'many', event: null, count: fresh.length, marker: next };
}

// Aendert sich, sobald ein Treffer dazukommt oder (auch am Handy) erledigt wird.
const openSignature = (events) => (events || []).map((e) => e.id).join(',');

module.exports = { nextNotification, openSignature };
