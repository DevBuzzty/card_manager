import { useState } from 'react';
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';

// Compact "NM · Unbek." chip; click opens two button rows (Zustand, Edition) for THIS row only.
export default function CopyChip({ edition = 'unknown', condition = 'NM', onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const std = edition === 'unknown' && condition === 'NM';
  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Zustand · Edition (nur diese Zeile)"
        className={`h-8 px-2 rounded-lg border text-[11px] font-mono whitespace-nowrap transition-colors ${
          std ? 'bg-black/40 border-gray-700 text-gray-400 hover:text-white' : 'bg-gold/10 border-gold/40 text-gold'
        }`}
      >
        {condition} · {EDITION_LABELS[edition] || edition}
      </button>
      {open && (
        <div className="absolute z-30 top-9 left-0 bg-[#1E1E1E] border border-gray-700 rounded-xl p-2 shadow-xl w-[300px]"
             onMouseLeave={() => setOpen(false)}>
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Zustand</div>
          <div className="flex gap-1 mb-2">
            {CONDITIONS.map(c => (
              <button key={c} type="button" onClick={() => onChange({ edition, condition: c })}
                className={`px-2 py-1 rounded text-[11px] font-mono ${c === condition ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 hover:bg-gray-700'}`}>{c}</button>
            ))}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Edition</div>
          <div className="flex gap-1">
            {EDITIONS.map(e => (
              <button key={e} type="button" onClick={() => onChange({ edition: e, condition })}
                className={`px-2 py-1 rounded text-[11px] ${e === edition ? 'bg-space-violet text-white' : 'bg-black/40 text-gray-300 hover:bg-gray-700'}`}>{EDITION_LABELS[e]}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
