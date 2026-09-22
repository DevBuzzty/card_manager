const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { safeFolderName, imageFileName, saveListingImages } = require('./listing-images.cjs');

test('Ordnername dateinamen-sicher', () => {
  assert.equal(safeFolderName('Yu-Gi-Oh! Konvolut 3 Karten – A/B: "C"?'), 'Yu-Gi-Oh! Konvolut 3 Karten – A B C');
  assert.equal(safeFolderName('  Titel mit Punkt am Ende...  '), 'Titel mit Punkt am Ende');
  assert.equal(safeFolderName('<>:|?*\\\t'), 'Angebot');
  assert.equal(safeFolderName(null), 'Angebot');
  assert.equal(safeFolderName('x'.repeat(90)).length, 80);
});

test('Dateinamen', () => {
  assert.equal(imageFileName(0, 'https://a/b/46986414.jpg'), '01.jpg');
  assert.equal(imageFileName(9, 'https://a/b/x.PNG?v=2'), '10.png');
  assert.equal(imageFileName(2, 'https://a/b/x'), '03.jpg');
});

test('Bilder speichern: nicht ladbare überspringen, doppelte einmal, nur https', async () => {
  const written = []; const dirs = [];
  const ok = (bytes) => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  const deps = {
    mkdir: (d) => dirs.push(d),
    writeFile: (f, b) => written.push([path.basename(f), b.length]),
    fetch: async (u) => {
      if (u.endsWith('/1.jpg')) return ok([1, 2, 3]);
      if (u.endsWith('/2.png')) return ok([4]);
      if (u.endsWith('/3.jpg')) return { ok: false };
      throw new Error('offline');
    },
  };
  const urls = ['https://i/1.jpg', 'https://i/2.png', 'https://i/1.jpg', 'https://i/3.jpg', 'http://i/5.jpg', 'https://i/4.jpg', null, ''];
  const r = await saveListingImages({ baseDir: 'C:\Bilder', title: 'Dunkler Magier: NM', urls }, deps);
  assert.deepEqual([r.saved, r.total], [2, 5]);
  assert.equal(r.folder, path.join('C:\Bilder', 'Yu-Gi-Oh Angebote', 'Dunkler Magier NM'));
  assert.deepEqual(dirs, [r.folder]);
  assert.deepEqual(written, [['01.jpg', 3], ['02.png', 1]]);
});
