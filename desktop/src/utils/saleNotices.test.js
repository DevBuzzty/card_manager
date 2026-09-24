import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { feesMark, noticeLabel, noticesTitle, sortNotices } from './saleNotices.js';

const F = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/ebay/notices.json', import.meta.url), 'utf8'));

test('Hinweise: offen, neueste zuerst (Fixture)', () => {
  for (const c of F.sort) assert.deepEqual(sortNotices(c.notices).map((n) => n.notice_id), c.ids, c.name);
});

test('Hinweis-Art: Beschriftung und Ton (Fixture)', () => {
  for (const c of F.labels) assert.deepEqual(noticeLabel(c.kind), { label: c.label, tone: c.tone }, c.kind);
});

test('Marke „Gebühren vorläufig“ (Fixture)', () => {
  for (const c of F.feesMark) assert.equal(feesMark(c.orders, c.saleId), c.mark, c.name);
});

test('Titel der Start-Karte (Fixture)', () => {
  for (const c of F.startTitle) assert.equal(noticesTitle(c.count), c.text);
});
