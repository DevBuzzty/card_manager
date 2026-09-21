import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import ExportDialog from './ExportDialog';
import { LOADING, forSaleSummary, forSaleGroups, forSaleHeaderText, copyValueText } from '../utils/duplicates';
import { createBusyGate } from '../utils/busyGate';
import { EDITION_LABELS } from '../utils/valuation';
import { formatCopyLocation } from '../utils/copyLocation';

// Spec H1 §5.1 -- Sammlung › Karten › Zum Verkauf. copies: Zeilen aus list-sale-copies (null = laedt), containers fuer
// den Standort, reload(): Promise, onOpenCard(copy). "Exportieren" oeffnet den F1-Export mit Format Verkaufsliste und
// genau diesen Exemplaren; "Zurück in die Sammlung" setzt for_sale = 0 (Busy-Gatter wie in DuplicatesList).
export default function ForSaleList({ copies, containers, reload, onOpenCard }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exportIds, setExportIds] = useState(null);

  const byId = useMemo(() => new Map((copies || []).map((c) => [c.copy_id, c])), [copies]);
  const groups = useMemo(() => (copies ? forSaleGroups(copies) : null), [copies]);
  const summary = useMemo(() => (copies ? forSaleSummary(copies) : null), [copies]);

  const giveBack = (copyId) => gate.run(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.setForSale({ copyIds: [copyId], value: false });
      if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
      await reload();
    } catch (e) {
      setError(e?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  });

  if (!groups) return <div className="h-full flex items-center justify-center text-ink-faint">{LOADING}</div>;

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 bg-obsidian-700 border border-line rounded-xl px-4 py-3 shrink-0">
        <span className="text-sm text-ink flex-1">{forSaleHeaderText(summary)}</span>
        <button type="button" onClick={() => setExportIds(groups.flatMap((g) => g.copy_ids))} disabled={summary.copies === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-obsidian-600 border border-line text-ink hover:border-space-violet/40 disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> Exportieren
        </button>
      </div>
      {exportIds && (
        <ExportDialog filterCopyIds={exportIds} initialFormat="salelist" filterLabel="Zum Verkauf" onClose={() => setExportIds(null)} />
      )}
      {error && <p className="text-sm text-crit">{error}</p>}
      {groups.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">Keine Exemplare zum Verkauf.</div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {groups.map((g) => {
            const first = byId.get(g.copy_ids[0]) || {};
            return (
              <div key={`${g.card_id}|${g.set_code}|${g.language}|${g.rarity}`} className="bg-obsidian-700 border border-line rounded-xl p-3">
                <button type="button" onClick={() => onOpenCard(first)} className="w-full flex items-center gap-3 text-left">
                  <div className="w-9 h-12 rounded overflow-hidden bg-obsidian-800 shrink-0">
                    {first.image_url && <img src={first.image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink truncate">{g.name || g.card_id}</div>
                    <div className="text-[11px] font-mono text-ink-faint">{g.set_code} · {g.rarity} · {g.language}</div>
                  </div>
                </button>
                <div className="mt-2 space-y-1">
                  {g.copy_ids.map((id) => {
                    const c = byId.get(id);
                    return (
                      <div key={id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-black/20 border border-gray-800 text-[11px]">
                        <span className="font-mono text-ink-muted">{c.condition} · {EDITION_LABELS[c.edition] || c.edition}</span>
                        <span className="font-mono text-ink-faint truncate">{formatCopyLocation(c, (containers || []).find((ct) => ct.container_id === c.container_id))}</span>
                        <span className="ml-auto font-mono text-gold">{copyValueText(c)}</span>
                        <button type="button" onClick={() => giveBack(id)} disabled={busy}
                          className="px-2 py-0.5 rounded text-[11px] bg-obsidian-600 border border-line text-ink-muted hover:text-ink disabled:opacity-50">
                          Zurück in die Sammlung
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
