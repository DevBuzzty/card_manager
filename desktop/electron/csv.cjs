// Spec F1 §2 -- CSV lesen und schreiben (RFC 4180), ohne Paket. Der Leser erkennt Komma, Semikolon und Tab an der
// Kopfzeile (Excel DE schreibt Semikolon), entfernt ein BOM und ueberspringt Leerzeilen. Jede Zeile traegt die
// Dateizeile, in der sie beginnt (ein Feld in Anfuehrungszeichen darf Zeilenumbrueche enthalten).
const BOM = '﻿';
const DELIMITERS = [',', ';', '\t'];

// Trennzeichen der ersten logischen Zeile (ausserhalb von Anfuehrungszeichen); Gleichstand -> Komma.
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of String(text)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && Object.hasOwn(counts, ch)) counts[ch] += 1;
  }
  let best = ',';
  for (const d of DELIMITERS) if (counts[d] > counts[best]) best = d;
  return best;
}

// -> { delimiter, rows: [{ line, cells: string[] }] }; Zeilen, deren Zellen alle leer sind, fehlen.
function parseCsv(input) {
  let text = String(input ?? '');
  if (text.startsWith(BOM)) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRow();
  return { delimiter, rows };
}

function csvCell(value, delimiter) {
  const s = value == null ? '' : String(value);
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: Array von Zellen-Arrays (Kopfzeile zuerst). UTF-8 mit BOM, CRLF (Excel), Komma.
function toCsv(rows, { delimiter = ',', bom = true } = {}) {
  const body = rows.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join('\r\n');
  return `${bom ? BOM : ''}${body}\r\n`;
}

module.exports = { BOM, detectDelimiter, parseCsv, toCsv };
