import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';

// Compact "NM · Unbek." chip; click opens two button rows (Zustand, Edition) for THIS row only.
//
// Das Panel haengt per Portal am <body> und wird mit festen Koordinaten positioniert -- wie
// CustomSelect. Vorher stand es `absolute` IM Scroll-Container der Staging-Liste: bei der untersten
// Karte (und erst recht bei Zusatzdruck-Zeilen) ragte es unten aus dem Fenster und war nicht mehr
// anklickbar (Nutzer 19.09.). Reicht der Platz darunter nicht, klappt es nach oben auf.
export default function CopyChip({ edition = 'unknown', condition = 'NM', onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const std = edition === 'unknown' && condition === 'NM';
  const PANEL_W = 300;
  const PANEL_H = 150;

  useLayoutEffect(() => {
    if (open && containerRef.current) setRect(containerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // ACHTUNG (Portal): Das Panel haengt am <body>, NICHT im Container -- ein Klick darauf ist
    // fuer den Container "ausserhalb". Ohne die zweite Pruefung schliesst mousedown das Panel,
    // bevor der click auf dem Knopf ankommt, und die Auswahl verpufft (Nutzer 20.09.). Gleiches
    // Muster wie CustomSelect.jsx (containerRef + menuRef).
    const close = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const reposition = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  let panelStyle = null;
  if (open && rect) {
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp = spaceBelow < PANEL_H && rect.top - 8 > spaceBelow;
    panelStyle = {
      position: 'fixed',
      left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_W - 8)),
      width: PANEL_W,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    };
  }

  const panel = (
    <div ref={panelRef} style={panelStyle} className="z-50 bg-surface border border-line rounded-xl p-2 shadow-sm">
      <div className="text-[9px] uppercase tracking-wider text-muted mb-1">Zustand</div>
      <div className="flex gap-1 mb-2">
        {CONDITIONS.map(c => (
          <button key={c} type="button" onClick={() => onChange({ edition, condition: c })}
            className={`px-2 py-1 rounded text-[11px] font-mono ${c === condition ? 'bg-accent text-accent-fg' : 'bg-bg/40 text-text hover:bg-surface-2'}`}>{c}</button>
        ))}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-muted mb-1">Edition</div>
      <div className="flex gap-1">
        {EDITIONS.map(e => (
          <button key={e} type="button" onClick={() => onChange({ edition: e, condition })}
            className={`px-2 py-1 rounded text-[11px] ${e === edition ? 'bg-accent text-accent-fg' : 'bg-bg/40 text-text hover:bg-surface-2'}`}>{EDITION_LABELS[e]}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Zustand · Edition (nur diese Zeile)"
        className={`h-8 px-2 rounded-lg border text-[11px] font-mono whitespace-nowrap transition-colors ${
          std ? 'bg-bg/40 border-line text-muted hover:text-text' : 'bg-warn/10 border-warn/40 text-text'
        }`}
      >
        {condition} · {EDITION_LABELS[edition] || edition}
      </button>
      {open && panelStyle && createPortal(panel, document.body)}
    </div>
  );
}
