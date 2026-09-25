import { X } from 'lucide-react';
import SellFlow from './SellFlow';

// Spec I §5.1 -- derselbe Verkaufen-Einstieg ausserhalb des Exemplar-Fensters (Kandidaten): ein Fenster,
// darin SellFlow. "Zurueck" aus den drei Wegen schliesst hier, weil es kein Exemplar-Fenster dahinter gibt.
// subtitle: frei wählbare Unterzeile (Mehrfachauswahl der Kartenliste); ohne sie gilt der Kandidaten-Text.
export default function SellFlowDialog({ title, subtitle = null, copies, onClose }) {
  const n = copies.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface w-full max-w-lg max-h-[85vh] rounded-2xl border border-line shadow-sm overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-line flex justify-between items-start gap-3 bg-surface-2">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-text">Verkaufen</h2>
            <p className="text-xs text-muted mt-0.5 truncate">{subtitle ?? `${title} · ${n === 1 ? '1 Exemplar' : `${n} Exemplare`} über dem Playset`}</p>
          </div>
          <button onClick={onClose} aria-label="Schließen" className="p-2 hover:bg-surface-2 rounded-full text-muted hover:text-text transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <SellFlow copies={copies} onBack={onClose} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
