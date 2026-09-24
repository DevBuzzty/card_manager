const test = require('node:test');
const assert = require('node:assert/strict');
const { nextNoticeNotification, noticeNotificationBody } = require('./notice-notify.cjs');

const N = (id, at, text = `Hinweis ${id}`) => ({ notice_id: id, created_at: at, text });

test('erster Lauf meldet nichts, merkt sich aber den neuesten Hinweis', () => {
  const r = nextNoticeNotification([N('a', '2026-09-24T10:00:00+00:00'), N('b', '2026-09-24T11:00:00+00:00')], null);
  assert.deepEqual([r.notify, r.marker], ['none', '2026-09-24T11:00:00+00:00']);
});

test('erster Lauf ohne Hinweise: der erste spätere Hinweis wird trotzdem gemeldet', () => {
  const r0 = nextNoticeNotification([], null);
  assert.equal(r0.marker, '0');
  const r1 = nextNoticeNotification([N('a', '2026-09-24T10:00:00+00:00', 'Versandkosten für eBay-Bestellung 1 nachtragen')], r0.marker);
  assert.deepEqual([r1.notify, r1.notice.notice_id], ['one', 'a']);
  assert.equal(noticeNotificationBody(r1), 'Versandkosten für eBay-Bestellung 1 nachtragen');
});

test('mehrere neue -> Sammeltext; schon gemeldete zählen nicht; Marke läuft nur vorwärts', () => {
  const m = '2026-09-24T10:00:00+00:00';
  const r = nextNoticeNotification([N('a', m), N('b', '2026-09-24T10:05:00+00:00'), N('c', '2026-09-24T10:06:00+00:00')], m);
  assert.deepEqual([r.notify, r.count, r.marker], ['many', 2, '2026-09-24T10:06:00+00:00']);
  assert.equal(noticeNotificationBody(r), '2 neue eBay-Hinweise');
  const later = nextNoticeNotification([N('a', m)], '2026-09-24T10:06:00+00:00');
  assert.deepEqual([later.notify, later.marker], ['none', '2026-09-24T10:06:00+00:00']);
});
