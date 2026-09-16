import { useState } from 'react';
import { Download } from 'lucide-react';
import { buildTextList, buildYdk, buildYdke } from '../utils/deckFormats';

// Spec E2 §6 — Export-Menue: YDK-Datei (Speichern-Dialog im Hauptprozess), YDKE und Textliste in die Zwischenablage.
// entries: [{ passcode, name, count, section }] aus dem Editor (ungespeicherter Stand).
export default function DeckExportMenu({ deckName, entries }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(null);

  const copy = async (text, done) => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(text);
      setNote(done);
    } catch (e) {
      setNote(`Kopieren fehlgeschlagen: ${e.message || e}`);
    }
  };

  const saveYdk = async () => {
    setOpen(false);
    try {
      const res = await window.api.exportDeckYdk({ name: deckName, content: buildYdk(entries) });
      if (res.success) setNote('YDK-Datei gespeichert');
    } catch (e) {
      setNote(`Export fehlgeschlagen: ${e.message || e}`);
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      {note && <span className="text-xs text-gray-400">{note}</span>}
      <button onClick={() => setOpen((v) => !v)} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium border border-gray-700">
        <Download className="w-4 h-4 mr-2" />
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-lg py-1">
          <button type="button" onClick={saveYdk} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">YDK-Datei</button>
          <button type="button" onClick={() => copy(buildYdke(entries), 'YDKE-Link kopiert')} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">YDKE kopieren</button>
          <button type="button" onClick={() => copy(buildTextList(entries), 'Textliste kopiert')} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Textliste kopieren</button>
        </div>
      )}
    </div>
  );
}
