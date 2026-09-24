// Spec H3b §7.6 (H3b2) — ob und wie der Desktop neue eBay-Hinweise (sale_notices) als Windows-Benachrichtigung meldet.
// Reiner Helfer (notice-notify.test.cjs), Muster alert-notify.cjs. `notices` sind die offenen Hinweise, `marker` ist das
// Setting sale_notices_notified_until (created_at-Text des neuesten schon gemeldeten Hinweises, '0' = noch keiner,
// null = erster Lauf). Der erste Lauf meldet nichts; die Marke läuft nur vorwärts. created_at kommt als Cloud-Text im
// immer gleichen Format (UTC, +00:00) -- Textvergleich reicht.
const FIRST_RUN_NONE = '0';

function nextNoticeNotification(notices, marker) {
  const list = (notices || []).filter((n) => n && typeof n.created_at === 'string' && n.created_at !== '');
  const max = list.reduce((m, n) => (n.created_at > m ? n.created_at : m), FIRST_RUN_NONE);
  const m = marker == null || marker === '' ? null : String(marker);
  if (m == null) return { notify: 'none', notice: null, count: 0, marker: max };
  const fresh = list.filter((n) => n.created_at > m)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.notice_id < b.notice_id ? -1 : 1));
  const next = max > m ? max : m;
  if (fresh.length === 0) return { notify: 'none', notice: null, count: 0, marker: next };
  if (fresh.length === 1) return { notify: 'one', notice: fresh[0], count: 1, marker: next };
  return { notify: 'many', notice: null, count: fresh.length, marker: next };
}

function noticeNotificationBody(r) {
  return r.notify === 'one' ? r.notice.text : `${r.count} neue eBay-Hinweise`;
}

module.exports = { nextNoticeNotification, noticeNotificationBody };
