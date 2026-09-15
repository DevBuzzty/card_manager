import { useState, useEffect } from 'react';
import { BellRing } from 'lucide-react';
import { parsePct, parseMinEur, toInput } from '../utils/alertInput';

const DEFAULTS = { pct: 20, min_eur: 2, days: 7, active: false };
const enterBlur = (e) => { if (e.key === 'Enter') e.currentTarget.blur(); };
const inputCls = (bad) => `w-20 bg-obsidian border rounded-lg px-2 py-1 text-ink font-mono ${bad ? 'border-crit' : 'border-line'}`;

// Spec G2 §6.3 — Einstellungen › Preise › Preis-Alarme. Ohne gespeicherte Regel ist der Bewegungsalarm
// aus; die Felder zeigen dann die Standardwerte, und das erste Speichern legt die Regel an.
export default function PriceAlertSettings() {
  const [status, setStatus] = useState(() => (window.api?.getPriceAlertMove ? 'loading' : 'error'));
  const [rule, setRule] = useState(DEFAULTS);
  const [text, setText] = useState({ pct: toInput(DEFAULTS.pct), min_eur: toInput(DEFAULTS.min_eur) });
  const [errors, setErrors] = useState({ pct: null, min_eur: null, save: null });

  useEffect(() => {
    if (!window.api?.getPriceAlertMove) return undefined;
    let alive = true;
    window.api.getPriceAlertMove()
      .then((r) => {
        if (!alive) return;
        const cur = r ? { pct: Number(r.pct), min_eur: Number(r.min_eur), days: Number(r.days), active: !!r.active } : DEFAULTS;
        setRule(cur);
        setText({ pct: toInput(cur.pct), min_eur: toInput(cur.min_eur) });
        setStatus('ready');
      })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, []);

  const save = async (patch) => {
    const pct = parsePct(text.pct);
    const minEur = parseMinEur(text.min_eur);
    setErrors({ pct: pct.error, min_eur: minEur.error, save: null });
    if (pct.error || minEur.error) return;
    const next = { ...rule, pct: pct.value, min_eur: minEur.value, ...patch };
    if (next.pct === rule.pct && next.min_eur === rule.min_eur && next.days === rule.days && next.active === rule.active) return;
    try {
      await window.api.savePriceAlertMove(next);
      setRule(next);
    } catch {
      setErrors((e) => ({ ...e, save: 'Speichern fehlgeschlagen' }));
    }
  };

  return (
    <div className="border-t border-line pt-6">
      <div className="text-sm font-bold text-ink-muted mb-2 uppercase tracking-wider flex items-center gap-2">
        <BellRing className="w-4 h-4" /> Preis-Alarme
      </div>
      {status === 'loading' && <div className="h-10 rounded-lg bg-obsidian-800 animate-pulse" />}
      {status === 'error' && <p className="text-sm text-crit">Preis-Alarme nicht verfügbar — Cloud nicht verbunden.</p>}
      {status === 'ready' && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={rule.active} onChange={(e) => save({ active: e.target.checked })}
              className="accent-space-violet w-4 h-4" />
            Bewegungsalarm
          </label>
          <div className="flex items-center gap-2 flex-wrap text-sm text-ink-muted">
            <span>ab</span>
            <input value={text.pct} inputMode="decimal" aria-label="ab Prozent"
              onChange={(e) => setText((t) => ({ ...t, pct: e.target.value }))}
              onBlur={() => save({})} onKeyDown={enterBlur} className={inputCls(errors.pct)} />
            <span>% und ab</span>
            <input value={text.min_eur} inputMode="decimal" aria-label="ab Euro"
              onChange={(e) => setText((t) => ({ ...t, min_eur: e.target.value }))}
              onBlur={() => save({})} onKeyDown={enterBlur} className={inputCls(errors.min_eur)} />
            <span>€ in</span>
            <select value={rule.days} onChange={(e) => save({ days: Number(e.target.value) })}
              className="bg-obsidian border border-line text-ink rounded-lg px-2 py-1">
              <option value={7}>7 Tagen</option>
              <option value={30}>30 Tagen</option>
            </select>
          </div>
          {(errors.pct || errors.min_eur || errors.save) && (
            <p className="text-xs text-crit">{errors.pct || errors.min_eur || errors.save}</p>
          )}
          <p className="text-xs text-ink-faint">Ausgewertet wird stündlich in der Cloud. Am Handy erscheinen Treffer beim Öffnen.</p>
        </div>
      )}
    </div>
  );
}
