import { useState, useEffect } from 'react';
import { parseTarget, toInput } from '../utils/alertInput';

const errorText = (e) => (String(e?.message || '').includes('Cloud nicht verbunden') ? 'Cloud nicht verbunden' : 'nicht verfügbar');

// Spec G2 §6.3 — "Preis-Alarm: ≥ [ ] € · ≤ [ ] €" unter dem Preisverlauf eines Printings. Gespeichert wird
// beim Verlassen des Felds oder mit Enter, und nur bei geaendertem Wert: jedes Speichern macht den
// Zielpreis wieder scharf (Spec §4.1) und darf nicht nebenbei passieren. Leer = entfernen.
export default function PriceAlertTargets({ printing }) {
  const { id, set_code: setCode, language, rarity } = printing;
  const [state, setState] = useState(() => (window.api?.getPriceAlertTargets
    ? { error: null, targets: null }
    : { error: 'nicht verfügbar', targets: null }));
  const [text, setText] = useState({ above: '', below: '' });
  const [fieldError, setFieldError] = useState({ above: null, below: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!window.api?.getPriceAlertTargets) return undefined;
    let alive = true;
    window.api.getPriceAlertTargets({ id, set_code: setCode, language, rarity })
      .then((targets) => {
        if (!alive) return;
        setState({ error: null, targets });
        setText({ above: toInput(targets.above?.threshold), below: toInput(targets.below?.threshold) });
      })
      .catch((e) => { if (alive) setState((s) => ({ error: errorText(e), targets: s.targets })); });
    return () => { alive = false; };
  }, [id, setCode, language, rarity, tick]);

  const save = async (kind) => {
    const parsed = parseTarget(text[kind]);
    setFieldError((f) => ({ ...f, [kind]: parsed.error }));
    if (parsed.error) return;
    const current = state.targets?.[kind]?.threshold ?? null;
    if (parsed.value === current) return;
    try {
      await window.api.savePriceAlertTarget({ printing: { id, set_code: setCode, language, rarity }, kind, threshold: parsed.value });
      setTick((t) => t + 1);
    } catch {
      setFieldError((f) => ({ ...f, [kind]: 'Speichern fehlgeschlagen' }));
    }
  };

  if (!state.targets) {
    return state.error
      ? <div className="text-[11px] text-ink-faint py-1">Preis-Alarm: {state.error}</div>
      : <div className="h-7" aria-hidden="true" />;
  }

  const field = (kind, sign) => (
    <span className="flex items-center gap-1">
      <span className="text-ink-muted">{sign}</span>
      <input value={text[kind]} inputMode="decimal" aria-label={`Preis-Alarm ${sign}`}
        onChange={(e) => setText((t) => ({ ...t, [kind]: e.target.value }))}
        onBlur={() => save(kind)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={`w-16 bg-black/40 border rounded px-1 py-0.5 text-xs text-white font-mono ${fieldError[kind] ? 'border-crit' : 'border-gray-700'}`} />
      <span className="text-ink-muted">€</span>
      {state.targets[kind] && !state.targets[kind].armed && <span className="text-[10px] text-gold">ausgelöst</span>}
    </span>
  );

  return (
    <div className="py-1 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-ink-muted">Preis-Alarm:</span>
        {field('above', '≥')}
        <span className="text-ink-faint">·</span>
        {field('below', '≤')}
      </div>
      {(fieldError.above || fieldError.below) && (
        <div className="text-[11px] text-crit mt-0.5">{fieldError.above || fieldError.below}</div>
      )}
      {state.error && <div className="text-[11px] text-ink-faint mt-0.5">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
    </div>
  );
}
