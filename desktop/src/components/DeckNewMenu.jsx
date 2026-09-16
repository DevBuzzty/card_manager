import { useState } from 'react';
import { Plus } from 'lucide-react';

// Spec E2 §5 — Menue "Neues Deck": Leer · YDK-Datei · Einfügen (YDKE/Text). Import legt immer ein neues Deck an.
export default function DeckNewMenu({ onEmpty, onYdkFile, onPaste }) {
  const [open, setOpen] = useState(false);
  const choose = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="p-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded transition-colors" title="Neues Deck">
        <Plus className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-lg py-1">
          <button type="button" onClick={choose(onEmpty)} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Leer</button>
          <button type="button" onClick={choose(onYdkFile)} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">YDK-Datei</button>
          <button type="button" onClick={choose(onPaste)} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Einfügen (YDKE/Text)</button>
        </div>
      )}
    </div>
  );
}
