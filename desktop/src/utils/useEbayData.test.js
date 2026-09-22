// Abschluss-Fix B2 -- Antwort von ebay-status in den Renderer-Stand übersetzen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusFromReply } from './useEbayData.js';

test('statusFromReply: pending -> undefined (lädt), sonst Stand bzw. null', () => {
  assert.equal(statusFromReply({ status: null, pending: true }), undefined);
  assert.equal(statusFromReply({ status: null }), null);
  assert.equal(statusFromReply(undefined), null);
  assert.deepEqual(statusFromReply({ status: { connected: true } }), { connected: true });
});
