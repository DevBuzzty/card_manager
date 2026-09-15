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
  const [loadError, setLoadError] = useState('Preis-Alarme nicht verfügbar — Cloud nicht verbunden.');
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
      .catch((e) => {
        if (!alive) return;
        setLoadError(String(e?.message || '').includes('Cloud nicht verbunden')
          ? 'Preis-Alarme nicht verfügbar — Cloud nicht verbunden.'
          : 'Preis-Alarme konnten nicht geladen werden.');
        setStatus('error');
      });
    return () => { alive = false; };
  }, []);

  // Speichert eine vollstaendige Regel, wenn sie sich von der zuletzt gespeicherten unterscheidet.
  const saveRule = async (next) => {
    if (next.pct === rule.pct && next.min_eur === rule.min_eur && next.days === rule.days && next.active === rule.active) return;
    try {
      await window.api.savePriceAlertMove(next);
      setRule(next);
    } catch {
      setErrors((e) => ({ ...e, save: 'Speichern fehlgeschlagen' }));
    }
  };

  // Kontrollkaestchen und Tage-Auswahl speichern unabhaengig von den Textfeldern: sie senden die
  // zuletzt gespeicherte pct/min_eur zusammen mit dem geaenderten Wert, ohne den Feldtext zu pruefen.
  const saveToggle = (patch) => {
    setErrors((e) => ({ ...e, save: null }));
    saveRule({ ...rule, ...patch });
  };

  // Jedes Zahlenfeld prueft beim Verlassen nur sich selbst; das jeweils andere Feld bleibt
  // unangetastet und kann ungueltigen/unvollstaendigen Text behalten, ohne das Speichern zu blockieren.
  const savePct = () => {
    const parsed = parsePct(text.pct);
    setErrors((e) => ({ ...e, pct: parsed.error, save: null }));
    if (parsed.error) return;
    saveRule({ ...rule, pct: parsed.value });
  };

  const saveMinEur = () => {
    const parsed = parseMinEur(text.min_eur);
    setErrors((e) => ({ ...e, min_eur: parsed.error, save: null }));
    if (parsed.error) return;
    saveRule({ ...rule, min_eur: parsed.value });
  };

  return (
    <div className="border-t border-line pt-6">
      <div className="text-sm font-bold text-ink-muted mb-2 uppercase tracking-wider flex items-center gap-2">
        <BellRing className="w-4 h-4" /> Preis-Alarme
      </div>
      {status === 'loading' && <div className="h-10 rounded-lg bg-obsidian-800 animate-pulse" />}
      {status === 'error' && <p className="text-sm text-crit">{loadError}</p>}
      {status === 'ready' && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={rule.active} onChange={(e) => saveToggle({ active: e.target.checked })}
              className="accent-space-violet w-4 h-4" />
            Bewegungsalarm
          </label>
          <div className="flex items-center gap-2 flex-wrap text-sm text-ink-muted">
            <span>ab</span>
            <input value={text.pct} inputMode="decimal" aria-label="ab Prozent"
              onChange={(e) => setText((t) => ({ ...t, pct: e.target.value }))}
              onBlur={savePct} onKeyDown={enterBlur} className={inputCls(errors.pct)} />
            <span>% und ab</span>
            <input value={text.min_eur} inputMode="decimal" aria-label="ab Euro"
              onChange={(e) => setText((t) => ({ ...t, min_eur: e.target.value }))}
              onBlur={saveMinEur} onKeyDown={enterBlur} className={inputCls(errors.min_eur)} />
            <span>€ in</span>
            <select value={rule.days} onChange={(e) => saveToggle({ days: Number(e.target.value) })}
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
