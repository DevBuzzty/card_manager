// eBay „zuletzt verkauft" E1 §8 -- Zeile je Druck im Karten-Detail: Wert/Zustand, aufklappbare Belege, Knopf
// "jetzt bei eBay prüfen". Text-Regel im Zwilling utils/ebaySold.js (Gegenstück ui/EbaySoldRow.kt).
import { useEffect, useRef, useState } from 'react';
import { ebaySoldLine, ebaySoldCanCheck } from '../utils/ebaySold';
import { fmtEUR } from '../utils/format';

const printingOf = (v) => ({ card_id: String(v.id), set_code: v.set_code, language: v.language || 'DE', rarity: v.rarity });

export default function EbaySoldRow({ variant, access = 'unbekannt' }) {
  const [state, setState] = useState({ row: null, access, loaded: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const key = `${variant.id}|${variant.set_code}|${variant.language}|${variant.rarity}`;

  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let alive = true;
    setState({ row: null, access, loaded: false });
    setOpen(false); setError(null); setBusy(false);
    if (!window.api?.ebaySoldGet) return undefined;
    window.api.ebaySoldGet(printingOf(variant))
      .then((r) => { if (alive) setState({ row: r?.row ?? null, access: r?.access ?? access, loaded: true }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, loaded: true })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!state.loaded) return null;
  const sales = state.row?.sales ?? [];
  const check = async () => {
    const k = key;
    const current = () => keyRef.current === k;
    setBusy(true); setError(null);
    try {
      const r = await window.api.ebaySoldCheck(printingOf(variant));
      if (!current()) return;
      setState({ row: r?.row ?? state.row, access: r?.access ?? state.access, loaded: true });
      if (r && r.ok === false && r.access !== 'fehlt') setError(r.error || 'eBay-Abruf fehlgeschlagen.');
    } catch (e) {
      if (current()) setError(e?.message || 'eBay-Abruf fehlgeschlagen.');
    } finally { if (current()) setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button type="button" className="text-xs text-muted text-left disabled:cursor-default"
          disabled={sales.length === 0} onClick={() => setOpen((o) => !o)}>
          {ebaySoldLine(state.access, state.row)}{sales.length > 0 ? (open ? ' ▾' : ' ▸') : ''}
        </button>
        {ebaySoldCanCheck(state.access) && (
          <button type="button" className="text-xs text-accent hover:underline disabled:opacity-50" disabled={busy} onClick={check}>
            {busy ? 'prüfe …' : 'jetzt bei eBay prüfen'}
          </button>
        )}
      </div>
      {error && <span className="text-xs text-bad">{error}</span>}
      {open && sales.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-2 border-l border-line">
          {sales.map((s, i) => (
            <li key={i} className="text-xs text-muted flex gap-2">
              <span className="font-mono">{s.sold_at ? `${s.sold_at.slice(8, 10)}.${s.sold_at.slice(5, 7)}.` : '–'}</span>
              <span className="font-mono">{fmtEUR(s.price)}</span>
              {s.first && <span>1. Aufl.</span>}
              {s.url
                ? <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => window.api?.openExternal?.(s.url)}>{s.title}</button>
                : <span className="min-w-0 truncate">{s.title}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
