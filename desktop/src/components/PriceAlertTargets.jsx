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
  // reload.kind: welches Feld den Nachlade-Trigger ausgeloest hat. null beim ersten Laden (dann werden
  // beide Felder gesetzt); nach dem Speichern eines Felds wird nur dieses Feld aktualisiert, damit ein
  // noch unbestaetigter Text im jeweils anderen Feld nicht ueberschrieben wird.
  const [reload, setReload] = useState({ n: 0, kind: null });

  useEffect(() => {
    if (!window.api?.getPriceAlertTargets) return undefined;
    let alive = true;
    window.api.getPriceAlertTargets({ id, set_code: setCode, language, rarity })
      .then((targets) => {
        if (!alive) return;
        setState({ error: null, targets });
        if (reload.kind) {
          setText((t) => ({ ...t, [reload.kind]: toInput(targets[reload.kind]?.threshold) }));
        } else {
          setText({ above: toInput(targets.above?.threshold), below: toInput(targets.below?.threshold) });
        }
      })
      .catch((e) => { if (alive) setState((s) => ({ error: errorText(e), targets: s.targets })); });
    return () => { alive = false; };
  }, [id, setCode, language, rarity, reload]);

  const save = async (kind) => {
    const parsed = parseTarget(text[kind]);
    setFieldError((f) => ({ ...f, [kind]: parsed.error }));
    if (parsed.error) return;
    const current = state.targets?.[kind]?.threshold ?? null;
    if (parsed.value === current) return;
    try {
      await window.api.savePriceAlertTarget({ printing: { id, set_code: setCode, language, rarity }, kind, threshold: parsed.value });
      setReload((r) => ({ n: r.n + 1, kind }));
    } catch {
      setFieldError((f) => ({ ...f, [kind]: 'Speichern fehlgeschlagen' }));
    }
  };

  if (!state.targets) {
    return state.error
      ? <div className="text-[11px] text-muted py-1">Preis-Alarm: {state.error}</div>
      : <div className="h-7" aria-hidden="true" />;
  }

  const field = (kind, sign) => (
    <span className="flex items-center gap-1">
      <span className="text-muted">{sign}</span>
      <input value={text[kind]} inputMode="decimal" aria-label={`Preis-Alarm ${sign}`}
        onChange={(e) => setText((t) => ({ ...t, [kind]: e.target.value }))}
        onBlur={() => save(kind)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={`w-16 bg-black/40 border rounded px-1 py-0.5 text-xs text-white font-mono ${fieldError[kind] ? 'border-bad' : 'border-gray-700'}`} />
      <span className="text-muted">€</span>
      {state.targets[kind] && !state.targets[kind].armed && <span className="text-[10px] text-warn">ausgelöst</span>}
    </span>
  );

  return (
    <div className="py-1 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted">Preis-Alarm:</span>
        {field('above', '≥')}
        <span className="text-muted">·</span>
        {field('below', '≤')}
      </div>
      {(fieldError.above || fieldError.below) && (
        <div className="text-[11px] text-bad mt-0.5">{fieldError.above || fieldError.below}</div>
      )}
      {state.error && <div className="text-[11px] text-muted mt-0.5">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
    </div>
  );
}
