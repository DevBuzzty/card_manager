import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { List } from 'react-window';
import { PREVIEW_FILTERS, IMPORT_RULES, visibleRows, canApply, omitAllUnknown, rowLabel } from '../utils/importPreview';

const DOT = { green: 'bg-good', yellow: 'bg-gold', red: 'bg-crit' };

// Eine Zeile der virtualisierten Vorschau (react-window 2: Props kommen über rowProps).
function PreviewRow({ index, style, rows, omitted, toggleOmit }) {
  const r = rows[index];
  return (
    <div style={style} className="flex items-center gap-2 px-2 border-b border-line/50 text-xs">
      <span className={clsx('w-2 h-2 rounded-full shrink-0', DOT[r.status])} />
      <span className="font-mono text-ink-faint w-10 shrink-0">Z. {r.line}</span>
      <div className="min-w-0 flex-1">
        <div className={clsx('truncate', omitted.has(r.line) ? 'text-ink-faint line-through' : 'text-ink')}>{rowLabel(r)}</div>
        {r.reasons.length > 0 && <div className="truncate text-ink-muted">{r.reasons.join(' · ')}</div>}
      </div>
      {r.status === 'red' && (
        <button type="button" onClick={() => toggleOmit(r.line)} className="px-2 py-1 rounded bg-obsidian border border-line text-ink-muted hover:text-ink shrink-0">
          {omitted.has(r.line) ? 'Zurücknehmen' : 'Auslassen'}
        </button>
      )}
    </div>
  );
}

// Spec F1 §3 — Card-Dex-Import: Vorschau mit Ampel, Regel für Bestehendes, Übernehmen.
// opened: Antwort von window.api.importOpen() ({ token, fileName, preview } oder { error }); den Dateidialog öffnet der
// Aufrufer, bevor er diesen Dialog zeigt (kein Seiteneffekt beim Einhängen, StrictMode hängt Effekte doppelt ein).
export default function ImportDialog({ opened, onClose }) {
  const [phase, setPhase] = useState(opened.error ? 'done' : 'preview'); // preview | running | done
  const [preview, setPreview] = useState(opened.preview || null);
  const [rule, setRule] = useState('add');
  const [filter, setFilter] = useState('all');
  const [omitted, setOmitted] = useState(new Set());
  const [error, setError] = useState(opened.error || null);
  const [result, setResult] = useState(null);
  const { token, fileName } = opened;

  const changeRule = async (next) => {
    setRule(next);
    const res = await window.api.importResolve({ token, rule: next });
    if (res.error) setError(res.error); else setPreview(res.preview);
  };

  const toggleOmit = (line) => setOmitted((prev) => {
    const next = new Set(prev);
    if (next.has(line)) next.delete(line); else next.add(line);
    return next;
  });

  const rows = useMemo(() => visibleRows(preview?.rows, filter), [preview, filter]);
  const ready = preview && canApply(preview.rows, omitted);

  const apply = async () => {
    if (phase !== 'preview' || !ready) return;
    setPhase('running');
    setError(null);
    try {
      const res = await window.api.importRun({ token, rule, omitLines: [...omitted] });
      if (res.success) setResult(res.text); else setError(res.error);
    } catch (e) {
      setError(`Import fehlgeschlagen: ${e.message || e}`);
    }
    setPhase('done');
  };

  const busy = phase === 'running';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-obsidian-700 border border-line rounded-2xl p-6 gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Importieren{fileName && ` – ${fileName}`}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {preview && phase !== 'done' && (
          <>
            <p className="font-mono text-sm text-ink">{preview.headerText}</p>
            {preview.catalogText && <p className="text-sm text-gold">{preview.catalogText}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint uppercase tracking-wide">Bestehendes</span>
              {IMPORT_RULES.map((o) => (
                <button key={o.value} type="button" onClick={() => changeRule(o.value)} disabled={busy}
                  className={clsx('px-3 py-1 rounded-lg text-xs border', rule === o.value ? 'bg-space-violet text-white border-space-violet' : 'bg-obsidian border-line text-ink-muted hover:text-ink')}>
                  {o.label}
                </button>
              ))}
            </div>
            {preview.warningText && <p className="text-sm text-crit">{preview.warningText}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {PREVIEW_FILTERS.map((o) => (
                <button key={o.value} type="button" onClick={() => setFilter(o.value)}
                  className={clsx('px-3 py-1 rounded-full text-xs border', filter === o.value ? 'bg-space-violet/20 border-space-violet/50 text-ink' : 'bg-obsidian border-line text-ink-muted hover:text-ink')}>
                  {o.label}
                </button>
              ))}
              {preview.summary.red > 0 && (
                <button type="button" onClick={() => setOmitted(omitAllUnknown(preview.rows))} className="ml-auto text-xs text-ink-muted hover:text-ink">
                  Alle unbekannten auslassen
                </button>
              )}
            </div>
            <div className="h-[45vh] border border-line rounded-xl overflow-hidden">
              <List rowComponent={PreviewRow} rowCount={rows.length} rowHeight={44} rowProps={{ rows, omitted, toggleOmit }} />
            </div>
          </>
        )}

        {result && <p className="text-sm text-good">{result}</p>}
        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">
            {phase === 'done' ? 'Schließen' : 'Abbrechen'}
          </button>
          {phase !== 'done' && (
            <button type="button" onClick={apply} disabled={busy || !ready}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
              {phase === 'running' ? 'Wird importiert…' : 'Übernehmen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
