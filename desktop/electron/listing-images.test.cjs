const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { safeFolderName, imageFileName, saveListingImages } = require('./listing-images.cjs');

test('Ordnername dateinamen-sicher', () => {
  assert.equal(safeFolderName('Yu-Gi-Oh! Konvolut 3 Karten – A/B: "C"?'), 'Yu-Gi-Oh! Konvolut 3 Karten – A B C');
  assert.equal(safeFolderName('  Titel mit Punkt am Ende...  '), 'Titel mit Punkt am Ende');
  assert.equal(safeFolderName('<>:|?*\\\t'), 'Angebot');
  assert.equal(safeFolderName(null), 'Angebot');
  assert.equal(safeFolderName('x'.repeat(90)).length, 80);
});

test('Ordnername: Windows-Reservenamen werden mit "_" entschärft (Minor 1)', () => {
  for (const n of ['CON', 'prn', 'Aux', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9']) assert.equal(safeFolderName(n), `${n}_`, n);
  assert.equal(safeFolderName('con.txt'), 'con_.txt');
  assert.equal(safeFolderName('LPT3.tar.gz'), 'LPT3_.tar.gz');
  assert.equal(safeFolderName('CON Karten'), 'CON Karten');
  assert.equal(safeFolderName('COM0'), 'COM0');
  assert.equal(safeFolderName('COM10'), 'COM10');
  assert.equal(safeFolderName('Console'), 'Console');
});

test('Dateinamen', () => {
  assert.equal(imageFileName(0, 'https://a/b/46986414.jpg'), '01.jpg');
  assert.equal(imageFileName(9, 'https://a/b/x.PNG?v=2'), '10.png');
  assert.equal(imageFileName(2, 'https://a/b/x'), '03.jpg');
});

test('Bilder speichern: nicht ladbare überspringen, doppelte einmal, nur https', async () => {
  const written = []; const dirs = [];
  const ok = (bytes) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } });
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

// Minor 1: nur image/*, hoechstens 10 MB (Content-Length UND beim Lesen). Eingespeistes fetch, echter Temp-Ordner.
test('Bilder speichern: nur image/*, Obergrenze 10 MB per Content-Length und beim Lesen', async () => {
  const MB = 1024 * 1024;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-images-'));
  try {
    let bigPulled = 0;
    const endless = () => new ReadableStream({ pull(c) { bigPulled += 1; c.enqueue(new Uint8Array(MB)); } });
    const deps = {
      mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
      writeFile: (f, b) => fs.writeFileSync(f, b),
      fetch: async (u) => {
        if (u.endsWith('/ok.png')) return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'Image/PNG' } });
        if (u.endsWith('/html.jpg')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
        if (u.endsWith('/none.jpg')) return new Response(new Uint8Array([1]));
        if (u.endsWith('/length.jpg')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg', 'content-length': String(10 * MB + 1) } });
        if (u.endsWith('/stream.jpg')) return new Response(endless(), { headers: { 'content-type': 'image/jpeg' } });
        if (u.endsWith('/exact.jpg')) return new Response(new Uint8Array(10 * MB), { headers: { 'content-type': 'image/jpeg' } });
        throw new Error('unerwartet ' + u);
      },
    };
    const urls = ['https://i/ok.png', 'https://i/html.jpg', 'https://i/none.jpg', 'https://i/length.jpg', 'https://i/stream.jpg', 'https://i/exact.jpg'];
    const r = await saveListingImages({ baseDir: tmp, title: 'CON', urls }, deps);
    assert.equal(r.folder, path.join(tmp, 'Yu-Gi-Oh Angebote', 'CON_'));
    assert.deepEqual([r.saved, r.total], [2, 6]);
    assert.deepEqual(fs.readdirSync(r.folder).sort(), ['01.png', '06.jpg']);
    assert.equal(fs.statSync(path.join(r.folder, '06.jpg')).size, 10 * MB);
    assert.ok(bigPulled <= 12, `Strom nach der Grenze abgebrochen (${bigPulled} MB gezogen)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
