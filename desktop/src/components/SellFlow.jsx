import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Store, ListPlus, ListX } from 'lucide-react';
import SaleDialog from './SaleDialog';
import ListingDialog from './ListingDialog';
import { useToast } from './toastContext';
import { lastChannel, nextSteps, NEXT_STEP_LABELS } from '../utils/saleFlow';
import { euroCentsText } from '../utils/saleMath';
import { ROUTES } from '../utils/routes';

// Spec I §5.1/§5.2 -- "Verkaufen" am Exemplar (und in "Kandidaten"): drei Wege IM SELBEN Fenster, kein
// Fensterstapel. Der Inhalt wechselt ueber `step`; ein Uebergang von 150 ms (Klasse .step-in, index.css)
// laesst die Liste dahinter stehen.
//   ways    -- Auswahl der drei Wege
//   sale    -- SaleDialog eingebettet (Kanal wie beim letzten Mal, Preis vorbelegt)
//   listing -- ListingDialog eingebettet
//   next    -- Vorschlaege fuer den naechsten Schritt (nur, wenn es mehr als "Fertig" gibt)
// Esc geht eine Stufe zurueck: Formular -> Wege -> onBack (Exemplar bzw. zu).
//
// copies:   die zu verkaufenden Exemplare (Zeilen mit copy_id, for_sale)
// siblings: weitere vorgemerkte Exemplare derselben Karte (fuer "Naechstes Exemplar")
export default function SellFlow({ copies, siblings = [], initialGrossCents = null, onBack, onClose, onOpenCopy }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('ways');
  const [next, setNext] = useState(null); // { way, listingId }
  const [defaultChannel, setDefaultChannel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const copyIds = copies.map((c) => c.copy_id);
  const allMarked = copies.length > 0 && copies.every((c) => !!c.for_sale);

  // Spec I §5.2 Punkt 2: Kanal wie beim letzten Mal -- aus den Verkaeufen selbst, kein neues Feld.
  useEffect(() => {
    let alive = true;
    window.api?.salesOverview?.({ period: 'gesamt' })
      .then((o) => { if (alive) setDefaultChannel(lastChannel(o?.sales || [])); })
      .catch(() => { if (alive) setDefaultChannel(lastChannel([])); });
    return () => { alive = false; };
  }, []);

  // Esc nur in den eigenen Schritten; im Formular gehoert Esc dem eingebetteten Dialog (-> onClose = zurueck).
  useEffect(() => {
    if (step !== 'ways' && step !== 'next') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); (step === 'next' ? onClose : onBack)?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onBack, onClose]);

  const finish = (way, listingId = null) => {
    const steps = nextSteps({ way, remaining: siblings.length, listingId });
    if (steps.length === 1) { onClose?.(); return; } // nur "Fertig": kein Schritt, den man wegklicken muesste
    setNext({ way, listingId, steps });
    setStep('next');
  };

  const onBooked = (saleId, info) => {
    const n = copyIds.length;
    const amount = info?.grossCents != null ? ` · ${euroCentsText(info.grossCents)}` : '';
    toast.show({
      text: `${n === 1 ? 'Verkauft gebucht' : `${n} Karten verkauft gebucht`}${amount}`,
      action: {
        label: 'Rückgängig',
        run: async () => {
          const res = await window.api.cancelSale(saleId);
          if (res?.success) { window.dispatchEvent(new Event('collection-dirty')); window.dispatchEvent(new Event('listings-dirty')); }
          else toast.show({ text: res?.error || 'Rückgängig fehlgeschlagen.' });
        },
      },
    });
    finish('verkauft');
  };

  const onListed = (listingIds) => {
    toast.show({ text: 'Angebot erstellt' });
    finish('angebot', listingIds?.[0] ?? null);
  };

  const toggleList = async () => {
    setBusy(true); setError(null);
    try {
      const value = !allMarked;
      const res = await window.api.setForSale({ copyIds, value });
      if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      toast.show(value
        ? { text: 'Auf der Verkaufsliste', action: { label: 'Ansehen', run: () => navigate(ROUTES.zumVerkauf) } }
        : { text: 'Von der Verkaufsliste genommen' });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const runStep = (s) => {
    if (s === 'fertig') onClose?.();
    else if (s === 'naechstes-exemplar' && siblings[0]) onOpenCopy?.(siblings[0]);
    else if (s === 'angebot-ansehen') { onClose?.(); navigate(ROUTES.angebote, { state: { openListingId: next?.listingId } }); }
    else if (s === 'verkaufsliste-ansehen') { onClose?.(); navigate(ROUTES.zumVerkauf); }
  };

  const way = 'w-full flex items-start gap-3 p-3 rounded-lg border border-line bg-surface-2 hover:border-accent/50 text-left transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const n = copyIds.length;

  return (
    <div key={step} className="step-in space-y-3">
      {step === 'ways' && (
        <>
          <p className="text-sm text-muted">{n === 1 ? '1 Exemplar' : `${n} Exemplare`} – wie möchtest du verkaufen?</p>
          <button type="button" autoFocus className={way} onClick={() => setStep('sale')} disabled={busy}>
            <Receipt className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <span><span className="block text-sm font-medium text-text">Verkauft buchen</span>
              <span className="block text-xs text-muted">Schon verkauft – Preis, Kanal und Datum erfassen.</span></span>
          </button>
          <button type="button" className={way} onClick={() => setStep('listing')} disabled={busy}>
            <Store className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <span><span className="block text-sm font-medium text-text">Angebot erstellen</span>
              <span className="block text-xs text-muted">Auf Cardmarket, eBay oder woanders einstellen.</span></span>
          </button>
          <button type="button" className={way} onClick={toggleList} disabled={busy}>
            {allMarked ? <ListX className="w-5 h-5 text-accent shrink-0 mt-0.5" /> : <ListPlus className="w-5 h-5 text-accent shrink-0 mt-0.5" />}
            <span><span className="block text-sm font-medium text-text">{allMarked ? 'Von der Verkaufsliste nehmen' : 'Auf die Verkaufsliste'}</span>
              <span className="block text-xs text-muted">{allMarked ? 'Bleibt in der Sammlung, nicht mehr vorgemerkt.' : 'Vormerken und später gesammelt verkaufen.'}</span></span>
          </button>
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end">
            <button type="button" onClick={onBack} className="px-3 py-2 text-sm text-muted hover:text-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Zurück</button>
          </div>
        </>
      )}
      {step === 'sale' && defaultChannel !== null && (
        <SaleDialog embedded copyIds={copyIds} initialGrossCents={initialGrossCents} defaultChannelId={defaultChannel}
          onClose={() => setStep('ways')} onBooked={onBooked} />
      )}
      {step === 'sale' && defaultChannel === null && <p className="text-muted">…</p>}
      {step === 'listing' && (
        <ListingDialog embedded copyIds={copyIds} onClose={() => setStep('ways')} onSaved={onListed} />
      )}
      {step === 'next' && next && (
        <>
          <p className="text-sm text-text">{next.way === 'verkauft' ? 'Gebucht.' : 'Angebot erstellt.'} Wie geht es weiter?</p>
          <div className="flex flex-wrap justify-end gap-2">
            {next.steps.map((s, i) => (
              <button key={s} type="button" autoFocus={i === 0} onClick={() => runStep(s)}
                className={`px-3 py-2 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${s === 'fertig' ? 'bg-accent text-accent-fg' : 'border border-line text-text hover:border-accent/50'}`}>
                {NEXT_STEP_LABELS[s]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
