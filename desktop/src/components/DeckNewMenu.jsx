import { useState } from 'react';
import { Plus } from 'lucide-react';

// Spec E2 §5 — Menue "Neues Deck": Leer · YDK-Datei · Einfügen (YDKE/Text). Import legt immer ein neues Deck an.
export default function DeckNewMenu({ onEmpty, onYdkFile, onPaste }) {
  const [open, setOpen] = useState(false);
  const choose = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="p-1.5 bg-accent hover:bg-accent/90 text-accent-fg rounded transition-colors" title="Neues Deck">
        <Plus className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-bg border border-line rounded-lg shadow-lg py-1">
          <button type="button" onClick={choose(onEmpty)} className="block w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-2">Leer</button>
          <button type="button" onClick={choose(onYdkFile)} className="block w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-2">YDK-Datei</button>
          <button type="button" onClick={choose(onPaste)} className="block w-full text-left px-3 py-2 text-sm text-text hover:bg-surface-2">Einfügen (YDKE/Text)</button>
        </div>
      )}
    </div>
  );
}
