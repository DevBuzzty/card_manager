// Spec F1 §2/§3 -- Aufloesung der gelesenen Card-Dex-Zeilen mit Ampel und die Regel fuer Bestehendes (Hinzufuegen,
// Ersetzen, Ueberspringen). Rein: der Datenbank-Stand kommt als `ctx` herein (carddex-import.cjs#loadResolveContext).
//
// ctx = {
//   catalog: null | { card(passcode) -> { name_de, name_en, type, image } | null }   // schon ueber die Artwork-Zuordnung
//   localCards: Map passcode -> { name, type, image_url }                              // jede cards-Zeile, auch geloeschte
//   printings: Map printingKey -> { live, located }                                    // lebende Printings, lebende Exemplare
//   containers: [{ container_id, name, kind, pockets_per_page }]                       // lebend, sort_order/name/container_id
//   occupied: Map slotKey -> Set printingKey                                            // lebende Exemplare mit Seite/Fach
//   defaults: { edition, condition }
// }
const { EDITIONS, CONDITIONS } = require('./valuation.cjs');
const { CONTAINER_KINDS, BINDER_POCKETS, normalizeTagList } = require('./copies.cjs');

const RULES = ['add', 'replace', 'skip'];
const MAX_COUNT = 1000;
const DEFAULT_POCKETS = 9;

const printingKey = (p) => [String(p.id), p.set_code, p.language, p.rarity].join('|');
const slotKey = (containerId, page, slot) => `${containerId}|${page}|${slot}`;
const positiveInt = (s) => (/^[0-9]+$/.test(String(s)) && Number(s) >= 1 ? Number(s) : null);

const REASON = {
  unknownPasscode: 'Passcode unbekannt',
  badCount: 'Menge ungültig',
  badEdition: (d) => `Edition ungültig – Standard ${d}`,
  badCondition: (d) => `Zustand ungültig – Standard ${d}`,
  newPrinting: 'Printing wird angelegt',
  skipExisting: 'Printing vorhanden – übersprungen',
  newContainer: (name) => `Behälter „${name}“ wird angelegt`,
  badKind: 'Behälter-Art ungültig – Box',
  badPockets: `Fächerzahl ungültig – ${DEFAULT_POCKETS}`,
  conflict: (name, line) => `Behälter „${name}“ weicht ab – Art und Fächerzahl aus Zeile ${line}`,
  notBinder: 'Behälter ist kein Binder – ohne Seite/Fach',
  badSlot: 'Seite/Fach ungültig – ohne Seite/Fach',
  occupied: 'Fach belegt – ohne Seite/Fach',
};

// Karte ueber lokale Sammlung (Passcode wie gespeichert) oder Katalog; fuehrende Nullen zaehlen nicht.
function findCard(raw, ctx) {
  if (!/^[0-9]{1,10}$/.test(raw)) return null;
  const norm = raw.replace(/^0+(?=[0-9])/, '');
  for (const id of [raw, norm]) if (ctx.localCards.has(id)) return { id, meta: ctx.localCards.get(id) };
  const cat = ctx.catalog ? ctx.catalog.card(norm) : null;
  if (!cat) return null;
  return { id: norm, meta: { name: cat.name_de || cat.name_en || null, type: cat.type || null, image_url: cat.image || null } };
}

function resolveBasics(row, ctx, rule) {
  const reasons = [];
  const card = findCard(row.passcode, ctx);
  if (!card) reasons.push(REASON.unknownPasscode);
  const count = positiveInt(row.count);
  if (count == null || count > MAX_COUNT) reasons.push(REASON.badCount);
  const printing = {
    id: card ? card.id : row.passcode, set_code: row.set_code || 'Unknown',
    language: (row.language || 'DE').toUpperCase(), rarity: row.rarity || 'Unknown',
  };
  const base = { line: row.line, name: row.name, printing, count, tags: normalizeTagList(row.tags), note: row.note || null,
    container: null, page: null, slot: null, meta: null };
  if (reasons.length) return { ...base, status: 'red', action: 'red', reasons, edition: row.edition, condition: row.condition };

  const edition = EDITIONS.includes(row.edition) ? row.edition : ctx.defaults.edition;
  if (edition !== row.edition) reasons.push(REASON.badEdition(ctx.defaults.edition));
  const cond = String(row.condition || '').toUpperCase();
  const condition = CONDITIONS.includes(cond) ? cond : ctx.defaults.condition;
  if (condition !== cond) reasons.push(REASON.badCondition(ctx.defaults.condition));

  const existing = ctx.printings.get(printingKey(printing));
  if (!existing) reasons.push(REASON.newPrinting);
  const skip = rule === 'skip' && !!existing;
  if (skip) reasons.push(REASON.skipExisting);
  return { ...base, edition, condition, reasons, meta: existing ? null : card.meta, action: skip ? 'skip-existing' : 'import' };
}

// Liegt in diesem Fach schon ein lebendes Exemplar, das nicht ersetzt wird?
function isOccupied(ctx, containerId, page, slot, replacedKeys) {
  const set = ctx.occupied.get(slotKey(containerId, page, slot));
  if (!set) return false;
  for (const key of set) if (!replacedKeys.has(key)) return true;
  return false;
}

function resolveContainer(r, row, ctx, plans, replacedKeys) {
  const name = row.container;
  if (!name) return;
  const fileKind = String(row.container_kind || '').toLowerCase();
  const filePockets = fileKind === 'binder' ? row.pockets_per_page : '';
  let plan = plans.get(name);
  if (!plan) {
    const existing = ctx.containers.find((c) => c.name === name);
    if (existing) {
      plan = { line: r.line, fileKind, filePockets, create: false, container_id: existing.container_id, kind: existing.kind, pockets: existing.pockets_per_page };
    } else {
      const kind = CONTAINER_KINDS.includes(fileKind) ? fileKind : 'box';
      if (kind !== fileKind) r.reasons.push(REASON.badKind);
      let pockets = null;
      if (kind === 'binder') {
        pockets = BINDER_POCKETS.includes(Number(filePockets)) ? Number(filePockets) : DEFAULT_POCKETS;
        if (filePockets !== '' && pockets !== Number(filePockets)) r.reasons.push(REASON.badPockets);
      }
      plan = { line: r.line, fileKind, filePockets, create: true, container_id: null, kind, pockets };
    }
    plans.set(name, plan);
  } else if (plan.fileKind !== fileKind || plan.filePockets !== filePockets) {
    r.reasons.push(REASON.conflict(name, plan.line));
  }
  if (plan.create) r.reasons.push(REASON.newContainer(name));
  r.container = { name, kind: plan.kind, pockets_per_page: plan.pockets, container_id: plan.container_id, create: plan.create };

  if (row.page === '' && row.slot === '') return;
  if (plan.kind !== 'binder') { r.reasons.push(REASON.notBinder); return; }
  const page = positiveInt(row.page);
  const slot = positiveInt(row.slot);
  const pockets = plan.pockets > 0 ? plan.pockets : 4;   // wie slotMath.js#clampPockets
  if (page == null || slot == null || slot > pockets) { r.reasons.push(REASON.badSlot); return; }
  if (!plan.create && isOccupied(ctx, plan.container_id, page, slot, replacedKeys)) { r.reasons.push(REASON.occupied); return; }
  r.page = page;
  r.slot = slot;
}

// rows: readCarddex(...).rows -> { rows: [aufgeloeste Zeile], summary }
function resolveCarddexRows(rows, ctx, rule = 'add') {
  const r0 = RULES.includes(rule) ? rule : 'add';
  const out = rows.map((row) => resolveBasics(row, ctx, r0));

  const replacedKeys = new Set();
  let replaced = 0;
  let replacedLocated = 0;
  if (r0 === 'replace') {
    for (const r of out) {
      if (r.action !== 'import') continue;
      const key = printingKey(r.printing);
      const existing = ctx.printings.get(key);
      if (!existing || replacedKeys.has(key)) continue;
      replacedKeys.add(key);
      replaced += existing.live;
      replacedLocated += existing.located;
    }
  }

  const plans = new Map();
  rows.forEach((row, i) => { if (out[i].action === 'import') resolveContainer(out[i], row, ctx, plans, replacedKeys); });
  for (const r of out) if (r.action !== 'red') r.status = r.reasons.length ? 'yellow' : 'green';

  const count = (pred) => out.filter(pred).length;
  return {
    rows: out,
    summary: {
      rule: r0, total: out.length, green: count((r) => r.status === 'green'), yellow: count((r) => r.status === 'yellow'),
      red: count((r) => r.status === 'red'), containersToCreate: [...plans.values()].filter((p) => p.create).length,
      replaced, replacedLocated, skippedExisting: count((r) => r.action === 'skip-existing'), catalogMissing: !ctx.catalog,
    },
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function previewHeaderText(s) {
  const parts = [plural(s.total, 'Zeile', 'Zeilen'), `${s.green} bereit`, `${s.yellow} mit Hinweis`, `${s.red} unbekannt`];
  if (s.containersToCreate > 0) parts.push(`${s.containersToCreate} Behälter ${s.containersToCreate === 1 ? 'wird' : 'werden'} angelegt`);
  return parts.join(' · ');
}

function replaceWarningText(s) {
  if (s.rule !== 'replace' || !s.replaced) return null;
  return `${plural(s.replaced, 'vorhandenes Exemplar wird', 'vorhandene Exemplare werden')} ersetzt, davon ${s.replacedLocated} mit Standort oder Tags`;
}

function importResultText(r) {
  const parts = [plural(r.imported, 'Exemplar importiert', 'Exemplare importiert'), `${r.containersCreated} Behälter angelegt`, `${r.omitted} ausgelassen`];
  if (r.skipped > 0) parts.push(`${r.skipped} übersprungen`);
  return parts.join(' · ');
}

module.exports = {
  RULES, MAX_COUNT, REASON, printingKey, slotKey, resolveCarddexRows, previewHeaderText, replaceWarningText, importResultText,
};
