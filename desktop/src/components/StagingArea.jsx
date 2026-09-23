import { useEffect, useCallback, useState, useRef } from 'react';
import { Check, X, Loader2, AlertCircle, FileSpreadsheet, Minus, Plus, HelpCircle, Edit } from 'lucide-react';
import { playScanSound } from '../utils/sound';
import CustomSelect from './CustomSelect';
import RarityGuide from './RarityGuide';
import CardSearchModal from './CardSearchModal';
import { Search } from 'lucide-react';
import { matchCandidates, phoneSelectedSet, mapPhoneConfidence } from '../utils/setCodeMatch';
import { fuelleRarityAusGeschwistern } from '../utils/printingRarity';
import { werteFuerZusatz } from '../utils/scanAggregate';
import Flag from './Flag';
import CopyChip from './CopyChip';

// Merge a card's printings from all sources into ONE flagged list: German (wiki+Konami) + English
// (YGOPRODeck, with prices) + Japanese (wiki+Konami). Each entry carries its language so the picker
// can show a flag and the commit knows the language. Deduped by code+rarity+language.
function mergePrintings(cardSets, germanSets, japaneseSets) {
    const de = (germanSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price || 0, language: 'DE', isYugipedia: true }));
    const en = (cardSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price, language: 'EN' }));
    const jp = (japaneseSets || []).map(s => ({ set_code: s.set_code, set_rarity: s.set_rarity, set_price: s.set_price || 0, language: 'JP', isYugipedia: true }));
    const seen = new Set();
    const out = [];
    for (const s of [...de, ...en, ...jp]) {
        const key = `${s.set_code}|${s.set_rarity}|${s.language}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    // Deutsche/japanische Drucke ohne Rarity uebernehmen die ihres gleichnummerigen Geschwisters --
    // sonst findet die Handy-Meldung ("MAMO-DE072, Ultra Rare") keinen Eintrag, und das Auswahlfeld
    // bleibt trotz gruener Ampel leer (siehe utils/printingRarity.js).
    return fuelleRarityAusGeschwistern(out);
}

const printingKey = (s) => s ? `${s.set_code}|${s.set_rarity}|${s.language}` : '';

// One dropdown listing EVERY printing of the card, each prefixed with its country flag — no
// separate language selector. Shared by a card's primary printing and its extra printings.
function PrintingPicker({ printings, selectedSet, onSelect, loading }) {
    if (!printings || printings.length === 0) {
        return (
            <div className="flex-1 bg-surface-2 rounded px-2 py-1 text-xs text-muted border border-line flex items-center justify-center">
                {loading ? 'Lade Druckvarianten…' : 'Keine Druckvarianten gefunden'}
            </div>
        );
    }
    return (
        <div className="flex-1">
            <CustomSelect
                value={printingKey(selectedSet)}
                onChange={(val) => onSelect(printings.find(s => printingKey(s) === val))}
                placeholder="Druckvariante wählen"
                options={printings.map((s, i) => ({
                    value: printingKey(s),
                    // Separate the language groups (DE | EN | JP) with a thin divider + spacing.
                    divider: i > 0 && printings[i - 1].language !== s.language,
                    label: (
                        <span className="inline-flex items-center gap-1.5">
                            <Flag lang={s.language} />
                            {`${s.set_code} - ${s.set_rarity}${s.language === 'EN' && s.set_price ? ` ($${s.set_price})` : ''}`}
                        </span>
                    )
                }))}
                className="w-full"
            />
        </div>
    );
}

export default function StagingArea({ scannedCards, setScannedCards, isUpdating }) {
  const [showRarityGuide, setShowRarityGuide] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
  const [ipAddress, setIpAddress] = useState('…');
  useEffect(() => { window.api?.getDefaults?.().then(d => d && setDefaults(d)); }, []);
  useEffect(() => { if (window.api) window.api.getIpAddress().then(setIpAddress); }, []);

  // Task 6 (Umzug von CollectionList.jsx): Unbekannt-Sammelaktionen leben jetzt hier. unknownCount
  // kommt aus nav-counts (cards.set_code = 'Unknown'), nicht mehr aus der geladenen Kartenliste.
  const [unknownCount, setUnknownCount] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let lebt = true;
    const laden = () => window.api?.navCounts?.().then(c => { if (lebt && c) setUnknownCount(c.unknown); }).catch(() => {});
    laden();
    // Fixrunde 1 (Review Task 6): onListingsChanged kommt nur vom Cloud-Pull -- lokale Aenderungen
    // (Karten-Detail, Verkauf, Angebot) feuern stattdessen die window-Ereignisse 'collection-dirty'/
    // 'listings-dirty' (siehe CardDetailPanel.jsx, SaleDialog.jsx, ListingDialog.jsx, ListingDetail.jsx).
    const ab = window.api?.onListingsChanged?.(laden);
    window.addEventListener('collection-dirty', laden);
    window.addEventListener('listings-dirty', laden);
    return () => {
        lebt = false;
        if (typeof ab === 'function') ab();
        window.removeEventListener('collection-dirty', laden);
        window.removeEventListener('listings-dirty', laden);
    };
  }, []);

  const runUnknownAction = async (kind) => {
      if (!window.api || busy) return;
      const msg = kind === 'merge'
          ? "Alle 'Unbekannt'-Karten in ihre häufigste vorhandene Set-Variante zusammenführen?"
          : "Alle 'Unbekannt'-Karten auf ihr günstigstes verfügbares Set setzen (online, kann dauern)?";
      if (!confirm(msg)) return;
      setBusy(true);
      try {
          const res = kind === 'merge' ? await window.api.mergeUnknownCards() : await window.api.convertUnknownsToDefault();
          if (res.success) {
              alert(kind === 'merge' ? `${res.merged} Karten zusammengeführt.` : `${res.converted} Karten umgestellt.`);
              // Fixrunde 1: eigene Sammelaktion aendert cards/card_copies -- Seitenleiste muss mitziehen.
              window.dispatchEvent(new Event('collection-dirty'));
          }
          else alert('Fehlgeschlagen: ' + res.error);
      } catch { alert('Aktion fehlgeschlagen.'); }
      finally { setBusy(false); }
  };

  const fetchCard = useCallback(async (tempId, passcode) => {
    // Set loading immediately to prevent double fetch
    setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, status: 'loading' } : c));

    if (!window.api) {
        // Mock (browser dev, window.api undefined)
        return new Promise(resolve => setTimeout(() => {
             setScannedCards(prev => prev.map(c => c.tempId === tempId ? {
                 ...c,
                 status: 'loaded',
                 data: { name: 'Blue-Eyes White Dragon', type: 'Normal Monster', race: 'Dragon', card_images: [{ image_url: 'https://images.ygoprodeck.com/images/cards/89631139.jpg' }] },
                 language: 'DE'
             } : c));
             resolve();
        }, 1000));
    }

    try {
        // Card data and the local ownership check run in parallel (Yugipedia is deferred below).
        const [data, result] = await Promise.all([
            window.api.fetchCardData(passcode),
            window.api.checkCardExists(passcode),
        ]);

        if (!data || data.error) {
            setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
            return;
        }

        // Show the card immediately with the English printings; German + Japanese load right after.
        setScannedCards(prev => prev.map(c => {
            if (c.tempId !== tempId) return c;
            const enPrintings = mergePrintings(data.card_sets, [], []);
            // Spec D3 Task 8: a phone that sent its own conclusion (`scannedConfidence` set) is
            // used AS-IS -- no local matchCandidates() fallback runs at all for that card. An
            // older phone never sends it, so `usePhoneMatch` is false and this stays exactly the
            // pre-Task-8 local-matching path.
            const usePhoneMatch = c.scannedConfidence != null;
            const phoneSet = usePhoneMatch ? phoneSelectedSet(c.scannedSetCode, c.scannedRarity, c.scannedLanguage, enPrintings) : null;
            const apiMatch = usePhoneMatch ? null : matchCandidates(c.scannedSetCandidates, data.card_sets);
            return {
                ...c,
                status: 'loaded',
                data,
                allPrintings: enPrintings,
                loadingSets: true,
                inCollection: result.exists,
                ownedQuantity: result.quantity,
                selectedSet: c.selectedSet || phoneSet || (apiMatch?.set ? { ...apiMatch.set, language: 'EN' } : (enPrintings[0] || null)),
                setAutoDetected: usePhoneMatch ? c.scannedConfidence !== 'red' : apiMatch.confidence !== 'none',
                setMatchConfidence: usePhoneMatch ? mapPhoneConfidence(c.scannedConfidence) : apiMatch.confidence,
                edition: c.edition || c.presetEdition || c.scannedEdition || defaults.edition,
                condition: c.condition || c.presetCondition || defaults.condition,
            };
        }));
        playScanSound();

        // Fetch German + Japanese printings in the background and merge into one flagged list.
        Promise.all([
            window.api.fetchYugipediaSets(passcode).then(s => s || []).catch(() => []),
            window.api.fetchJapaneseSets(passcode).then(s => s || []).catch(() => []),
        ]).then(([germanSets, japaneseSets]) => {
            setScannedCards(prev => prev.map(c => {
                if (c.tempId !== tempId) return c;
                const allPrintings = mergePrintings(c.data.card_sets, germanSets, japaneseSets);
                const keepSelection = c.setTouched || c.isManualEntry;
                let chosen = c.selectedSet;
                let auto = c.setAutoDetected;
                let confidence = c.setMatchConfidence;
                if (!keepSelection) {
                    if (c.scannedConfidence != null) {
                        // Spec D3 Task 8: still the phone's own conclusion, just re-resolved
                        // against the now-larger printings list (DE/JP just arrived) so it can
                        // pick up the real printing instead of the composed placeholder from the
                        // first setter above -- never blended with a local match.
                        chosen = phoneSelectedSet(c.scannedSetCode, c.scannedRarity, c.scannedLanguage, allPrintings) || chosen;
                        // Hat das Handy gar keinen Set-Code gelesen, bleibt die Sammlung DE-first:
                        // deutscher statt englischer Standarddruck (Nutzerentscheid 17.09.).
                        if (!c.scannedSetCode && germanSets.length > 0) {
                            chosen = { ...germanSets[0], language: 'DE', isYugipedia: true };
                        }
                        auto = c.scannedConfidence !== 'red';
                        confidence = mapPhoneConfidence(c.scannedConfidence);
                    } else {
                        // Prefer the German printing that matches the scanned set code (collection is DE-first).
                        const deMatch = matchCandidates(c.scannedSetCandidates, germanSets);
                        if (deMatch && deMatch.set) {
                            chosen = { ...deMatch.set, language: 'DE', isYugipedia: true };
                            auto = true;
                            confidence = deMatch.confidence;
                        } else if (germanSets.length > 0 && !c.setAutoDetected) {
                            chosen = { ...germanSets[0], language: 'DE', isYugipedia: true };
                        }
                    }
                }
                return { ...c, loadingSets: false, allPrintings, selectedSet: chosen, setAutoDetected: auto, setMatchConfidence: confidence };
            }));
        }).catch(() => {
            setScannedCards(prev => prev.map(c => c.tempId === tempId ? { ...c, loadingSets: false } : c));
        });
    } catch (e) {
        setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
    }
  }, [setScannedCards, defaults]);

  // Process pending scans with a concurrency cap so a large CSV import doesn't storm the APIs.
  const MAX_CONCURRENT_FETCHES = 5;
  const inFlightRef = useRef(0);
  // Guards handleAdd against re-entrant calls for the same card (e.g. OS key-repeat on Enter).
  const committingRef = useRef(new Set());

  useEffect(() => {
    const pending = scannedCards.filter(c => c.status === 'pending');
    if (pending.length === 0) return;
    let available = MAX_CONCURRENT_FETCHES - inFlightRef.current;
    for (const card of pending) {
      if (available <= 0) break;
      available--;
      inFlightRef.current++;
      fetchCard(card.tempId, card.passcode).finally(() => { inFlightRef.current--; });
    }
  }, [scannedCards, fetchCard]);

  const handleAdd = async (tempId) => {
    const card = scannedCards.find(c => c.tempId === tempId);
    if (card && card.status === 'loaded') {
       if (committingRef.current.has(tempId)) return;
       committingRef.current.add(tempId);
       try {
           // Commit the primary printing plus any extra printings the user added on this card.
           // Each printing's language comes from the picked set (its flag), so there's no separate
           // language field to track.
           const primary = {
               // `??` statt `||`: eine explizite 0 (Huelle nach vollstaendigem Schreiben, siehe
               // Zeile ~298) muss als 0 erhalten bleiben, damit der Wächter unten sie erkennt --
               // `|| 1` wuerde sie hier schon vor der Pruefung wieder auf 1 zurueckfallen lassen.
               quantity: card.quantity ?? 1,
               selectedSet: card.selectedSet,
               isManualEntry: card.isManualEntry,
               manualSetCode: card.manualSetCode,
               manualRarity: card.manualRarity,
               edition: card.edition,
               condition: card.condition,
           };
           const extrasSnapshot = card.extraPrintings || [];
           const printings = [primary, ...extrasSnapshot];

           const buildCardData = (p, isPrimary) => {
               const cardData = { ...card.data, quantity: p.quantity || 1 };
               if (p.isManualEntry) {
                   cardData.set_code = p.manualSetCode || 'Unknown';
                   cardData.rarity = p.manualRarity || 'Unknown';
                   cardData.price = 0;
                   cardData.language = 'DE'; // manual codes are German-first
               } else if (p.selectedSet) {
                   cardData.set_code = p.selectedSet.set_code;
                   cardData.rarity = p.selectedSet.set_rarity;
                   // Yugipedia/Konami sets have no price -> 0 (the API fallback fills it from card_prices).
                   cardData.price = parseFloat(p.selectedSet.set_price) || 0;
                   cardData.language = p.selectedSet.language || 'DE';
               } else if (isPrimary && card.data.card_sets && card.data.card_sets.length > 0) {
                   const first = card.data.card_sets[0];
                   cardData.set_code = first.set_code;
                   cardData.rarity = first.set_rarity;
                   cardData.price = parseFloat(first.set_price) || 0;
                   cardData.language = 'EN';
               } else {
                   return null; // an extra line with nothing picked — skip it rather than guess a wrong code
               }
               cardData.copies = [{ edition: p.edition || defaults.edition, condition: p.condition || defaults.condition, count: p.quantity || 1 }];
               return cardData;
           };

           // Spec-Fix I1: wie viel von jeder Zeile TATSAECHLICH geschrieben wurde. Der Hauptdruck
           // hat keine id (eigenes Feld), Zusatzzeilen ueber ihre id (Fix C1). Bleibt eine Zeile bei
           // 0 stehen, weil `buildCardData` nichts zu schreiben fand (keine Auswahl getroffen),
           // wird sie unten wie bisher stillschweigend uebersprungen -- das ist kein Wettlauf,
           // sondern strukturell unveraendert seit dem Anlegen der Zeile.
           let primaryWritten = 0;
           const extraWritten = new Map();

           if (window.api) {
                for (let i = 0; i < printings.length; i++) {
                    const p = printings[i];
                    const isPrimary = i === 0;
                    // Fixwelle-Nachreview: quantity <= 0 heisst, diese Zeile ist bereits
                    // vollstaendig geschrieben und steht nur noch als Huelle fuer ihre
                    // Geschwister-Zeilen (siehe Zeile ~298) -- `|| 1` weiter unten wuerde sie
                    // sonst als 1 zuruecklesen und eine nie gescannte Kopie schreiben.
                    if ((p.quantity ?? 1) <= 0) continue;
                    const data = buildCardData(p, isPrimary);
                    if (!data) continue;
                    const result = await window.api.addCardToDb(data);
                    if (!result.success) {
                        alert("Speichern fehlgeschlagen: " + result.error);
                        return; // keep the card in staging so nothing is silently lost
                    }
                    if (isPrimary) primaryWritten = p.quantity || 1;
                    else extraWritten.set(p.id, p.quantity || 1);
                }
                // Fixrunde 1 (Review Task 6): die Uebernahme aendert cards/card_copies, aber
                // feuerte bisher kein 'collection-dirty' -- Sidebar-Zaehler und CollectionList
                // erfuhren davon nur zufaellig ueber einen spaeteren Sync-Pull.
                window.dispatchEvent(new Event('collection-dirty'));
           } else {
                // Kein window.api (Browser-Dev) -- es wird ohnehin nichts persistiert, die Karte
                // verschwindet wie bisher unbedingt aus dem Staging.
                primaryWritten = primary.quantity || 1;
                extrasSnapshot.forEach(p => extraWritten.set(p.id, p.quantity || 1));
           }

           // Spec-Fix I1: waehrend der awaits oben kann applyScan (ein Wiederholscan vom Handy)
           // die Menge dieser Karte erhoeht oder eine neue Zusatzzeile angelegt haben -- der oben
           // aus dem Render-Schnappschuss gelesene `card` weiss davon nichts. Der DANN aktuelle
           // Zustand entscheidet: ist er groesser als das tatsaechlich Geschriebene, bleibt die
           // Differenz stehen, statt dass die Karte komplett verschwindet. Nur bei Gleichstand
           // (ueberall Differenz <= 0) wird der Eintrag entfernt und der Passcode freigegeben.
           // Die id-Menge der urspruenglichen Zusatzzeilen unterscheidet eine waehrenddessen NEU
           // angelegte Zeile (unangetastet stehen lassen) von einer schon damals leeren, nie
           // geschriebenen Zeile (weiterhin stillschweigend uebersprungen, wie bisher).
           const originalExtraIds = new Set(extrasSnapshot.map(p => p.id));
           let removedFully = false;
           setScannedCards(prev => {
               const idx = prev.findIndex(c => c.tempId === tempId);
               if (idx < 0) return prev; // anderswo schon entfernt (z.B. verworfen)
               const cur = prev[idx];
               const remainingQuantity = (cur.quantity || 1) - primaryWritten;
               const remainingExtras = (cur.extraPrintings || []).reduce((acc, p) => {
                   if (extraWritten.has(p.id)) {
                       const rem = (p.quantity || 1) - extraWritten.get(p.id);
                       if (rem > 0) acc.push({ ...p, quantity: rem });
                   } else if (!originalExtraIds.has(p.id)) {
                       acc.push(p); // waehrend des awaits neu angelegt -- unangetastet stehen lassen
                   }
                   return acc;
               }, []);
               if (remainingQuantity <= 0 && remainingExtras.length === 0) {
                   removedFully = true;
                   return prev.filter(c => c.tempId !== tempId);
               }
               removedFully = false;
               return prev.map((c, i) => (i === idx
                   ? { ...c, quantity: Math.max(remainingQuantity, 0), extraPrintings: remainingExtras }
                   : c));
           });
           if (removedFully) {
               // Spec D4 §6.4: die Karte ist durch -- das Handy darf sie wieder scannen.
               window.api?.releaseStaged?.([card.passcode]);
           }
       } finally {
           committingRef.current.delete(tempId);
       }
    }
  };

  // Enter commits the topmost loaded card (bulk scanning without the mouse).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const top = scannedCards.find(c => c.status === 'loaded');
      if (top) { e.preventDefault(); handleAdd(top.tempId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedCards]);

  const handleDiscard = (tempId) => {
      const card = scannedCards.find(c => c.tempId === tempId);
      if (card) window.api?.releaseStaged?.([card.passcode]);
      setScannedCards(prev => prev.filter(c => c.tempId !== tempId));
  };

  const handleClearAll = () => {
      if (confirm("Alle gescannten Karten verwerfen? Dies kann nicht rückgängig gemacht werden.")) {
          window.api?.releaseStaged?.(scannedCards.map(c => c.passcode));
          setScannedCards([]);
      }
  };

  const handleUpdateCard = (tempId, updates) => {
      setScannedCards(prev => prev.map(c => {
          if (c.tempId === tempId) {
              return { ...c, ...updates };
          }
          return c;
      }));
  };

  // Extra printings: let the user record several printings of the SAME scanned card (e.g. 2× the
  // German one + 1× the English) right here, instead of re-adding them from the collection later.
  // The user picks each printing (incl. its language) from the one flagged dropdown.
  const addPrinting = (tempId) => {
      setScannedCards(prev => prev.map(c => {
          if (c.tempId !== tempId) return c;
          const printing = { id: `${Date.now()}-${Math.random()}`, quantity: 1, selectedSet: null, ...werteFuerZusatz(c, null, defaults) };
          return { ...c, extraPrintings: [...(c.extraPrintings || []), printing] };
      }));
  };

  const updatePrinting = (tempId, pid, updates) => {
      setScannedCards(prev => prev.map(c => c.tempId === tempId
          ? { ...c, extraPrintings: (c.extraPrintings || []).map(p => p.id === pid ? { ...p, ...updates } : p) }
          : c));
  };

  const removePrinting = (tempId, pid) => {
      setScannedCards(prev => prev.map(c => c.tempId === tempId
          ? { ...c, extraPrintings: (c.extraPrintings || []).filter(p => p.id !== pid) }
          : c));
  };

  const handleImportCsv = async () => {
    if (window.api) {
        try {
            const result = await window.api.importCsv();
            if (result && !result.canceled && result.cards) {
                // Add to staging (append so the list stays oldest-first)
                setScannedCards(prev => [
                    ...prev,
                    ...result.cards.map(c => ({
                        tempId: Date.now() + Math.random(), // Unique temp ID
                        passcode: c.passcode,
                        status: 'pending',
                        data: null,
                        language: 'DE', // Default to DE for imports
                        presetEdition: c.edition,
                        presetCondition: c.condition
                    }))
                ]);
            }
        } catch (error) {
            console.error(error);
            alert("Fehler beim CSV-Import");
        }
    } else {
        alert("CSV-Import ist nur in der Desktop-App verfügbar.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-text flex items-center">
                Scannen
                <span className="ml-3 text-sm font-normal text-muted bg-bg px-2 py-1 rounded-full">{scannedCards.length}</span>
            </h2>
            <div className="flex space-x-2">
                {scannedCards.length > 0 && (
                    <button
                        onClick={handleClearAll}
                        className="flex items-center px-4 py-2 bg-bad/20 hover:bg-bad/30 text-bad hover:text-bad rounded-lg transition-colors text-sm border border-bad/30"
                    >
                        <X className="w-4 h-4 mr-2" />
                        Alles verwerfen
                    </button>
                )}
                {scannedCards.some(c => c.status === 'loaded' && c.setMatchConfidence === 'exact') && (
                     <button
                        onClick={() => {
                            scannedCards
                                .filter(c => c.status === 'loaded' && c.setMatchConfidence === 'exact')
                                .forEach(c => handleAdd(c.tempId));
                        }}
                        disabled={isUpdating}
                        className="flex items-center px-4 py-2 bg-good/20 hover:bg-good/30 text-good rounded-lg transition-colors text-sm border border-good/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Erkannte übernehmen
                    </button>
                )}
                {scannedCards.some(c => c.status === 'loaded') && (
                     <button
                        onClick={() => {
                            const loadedCards = scannedCards.filter(c => c.status === 'loaded');
                            loadedCards.forEach(c => handleAdd(c.tempId));
                        }}
                        disabled={isUpdating}
                        className="flex items-center px-4 py-2 bg-accent hover:bg-accent/90 text-accent-fg rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Alle übernehmen
                    </button>
                )}
                <button
                    onClick={handleImportCsv}
                    className="flex items-center px-4 py-2 bg-surface-2 hover:bg-bg text-text rounded-lg transition-colors text-sm border border-line"
                >
                    <FileSpreadsheet className="w-4 h-4 mr-2 text-good" />
                    CSV importieren
                </button>
                <button
                    onClick={() => setShowRarityGuide(true)}
                    className="flex items-center px-4 py-2 bg-surface-2 hover:bg-bg text-text rounded-lg transition-colors text-sm border border-line"
                >
                    <HelpCircle className="w-4 h-4 mr-2" />
                    Anleitung
                </button>
                <button
                    onClick={() => setShowSearch(true)}
                    className="flex items-center px-4 py-2 bg-surface-2 hover:bg-bg text-text rounded-lg transition-colors text-sm border border-line"
                >
                    <Search className="w-4 h-4 mr-2" />
                    Suchen
                </button>
            </div>
        </div>

        {showRarityGuide && (
            <RarityGuide onClose={() => setShowRarityGuide(false)} />
        )}

        {showSearch && (
            <CardSearchModal
                onClose={() => setShowSearch(false)}
                onSelect={(card) => {
                   setScannedCards(prev => [...prev, {
                       tempId: Date.now() + Math.random(),
                       passcode: String(card.id),
                       status: 'pending',
                       data: null,
                       language: 'DE'
                   }]);
                   setShowSearch(false);
                }}
            />
        )}

        {scannedCards.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-muted border-2 border-dashed border-line rounded-xl bg-bg/50 gap-2">
                <p className="text-lg font-medium text-text">Bereit zum Scannen</p>
                <p className="text-sm">Gescannte Karten erscheinen hier.</p>
                <code className="mt-2 bg-bg border border-line rounded-lg px-3 py-1.5 font-mono text-[13px] text-text select-all cursor-pointer"
                      title="Zum Kopieren klicken" onClick={() => navigator.clipboard.writeText(ipAddress)}>{ipAddress}</code>
                <p className="text-[11px] text-muted">Handy-App mit dieser Adresse verbinden</p>
            </div>
        )}

        <div className="grid grid-cols-1 gap-3">
            {scannedCards.map(card => (
                <div key={card.tempId} className="bg-surface p-3 rounded-xl border border-line flex items-center shadow-lg hover:border-line transition-colors">
                    {/* Status / Image */}
                    <div className="w-12 h-16 sm:w-16 sm:h-20 bg-bg rounded flex-shrink-0 border border-line overflow-hidden flex items-center justify-center mr-4 relative">
                        {card.status === 'loading' && <Loader2 className="animate-spin text-accent w-6 h-6" />}
                        {card.status === 'error' && <AlertCircle className="text-bad w-6 h-6" />}
                        {card.status === 'loaded' && card.data?.card_images?.[0]?.image_url && (
                             <img src={card.data.card_images[0].image_url_small || card.data.card_images[0].image_url} alt="Card" className="w-full h-full object-cover" />
                        )}
                        {card.status === 'pending' && <span className="text-xs text-muted">...</span>}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        {card.status === 'loading' && <div className="h-5 w-40 bg-surface-2 rounded animate-pulse mb-2"></div>}
                        {card.status === 'loaded' ? (
                            <>
                                <div className="flex items-center gap-2">
                                    {/* Traffic-light dot (Spec D3 Task 8): DISPLAYS the ampel the phone already
                                        computed (card.scannedConfidence) -- this screen never re-derives green/
                                        yellow/red itself, same as the phone's own StagingRow. Absent entirely for
                                        an older phone build (scannedConfidence undefined) or a manual/CSV entry. */}
                                    {card.scannedConfidence && (
                                        <span
                                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                                card.scannedConfidence === 'green' ? 'bg-good' :
                                                card.scannedConfidence === 'yellow' ? 'bg-warn' : 'bg-bad'
                                            }`}
                                            title={card.scannedReason || 'Vom Handy erkannt'}
                                        />
                                    )}
                                    <h3 className="font-bold text-lg text-text truncate">{card.data.name}</h3>
                                    {card.quantity > 1 && (
                                        <span className="px-2 py-0.5 bg-good/20 text-good text-[10px] font-bold uppercase rounded border border-good/30">
                                            x{card.quantity}
                                        </span>
                                    )}
                                    {card.inCollection && (
                                        <span className="px-2 py-0.5 bg-warn/20 text-warn text-[10px] font-bold uppercase rounded border border-warn/30">
                                            Vorhanden: x{card.ownedQuantity}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center text-xs space-x-2 mt-0.5 mb-2">
                                    <span className="text-accent font-mono bg-surface-2 px-1.5 py-0.5 rounded">{card.passcode}</span>
                                    <span className="text-muted truncate">{card.data.type}</span>
                                </div>
                                {/* Grund (Spec D3 Task 8): read verbatim off the phone's ScanConfidence result --
                                    already German, never re-translated or paraphrased here. `null`/absent exactly
                                    for GREEN (see ScanConfidence.Result's own doc), so nothing renders for a green
                                    card, same as the phone. */}
                                {card.scannedReason && (
                                    <p className="text-xs text-muted -mt-1 mb-2 truncate">{card.scannedReason}</p>
                                )}
                                {/* Der gelesene Set-Code hat die Bilderkennung ueberstimmt (main.cjs:
                                    korrigiereNachSetCode). Still korrigiert, hier nur vermerkt -- damit
                                    nachvollziehbar bleibt, warum eine andere Karte dasteht. */}
                                {card.correctedBy && (
                                    <p className="text-xs text-accent -mt-1 mb-2 truncate" title={`Bild erkannte Passcode ${card.correctedFrom}`}>
                                        Set-Code {card.correctedBy} hat entschieden
                                    </p>
                                )}

                                <div className="flex gap-2 items-center">
                                    {/* Quantity */}
                                    <div className="flex items-center bg-bg/40 rounded-lg border border-line p-0.5 h-8">
                                        <button
                                            onClick={() => handleUpdateCard(card.tempId, { quantity: Math.max(1, (card.quantity || 1) - 1) })}
                                            className="p-1 hover:bg-surface-2 rounded text-muted"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="w-6 text-center text-xs font-mono">{card.quantity || 1}</span>
                                        <button
                                            onClick={() => handleUpdateCard(card.tempId, { quantity: (card.quantity || 1) + 1 })}
                                            className="p-1 hover:bg-surface-2 rounded text-muted"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>

                                    {/* Printing (set code) — one flagged dropdown, no separate language selector */}
                                    <div className="flex-1 flex gap-2">
                                        {card.isManualEntry ? (
                                            <div className="flex gap-2 flex-1 animate-in fade-in zoom-in duration-200">
                                                <input
                                                    type="text"
                                                    placeholder="Set-Code"
                                                    className="w-1/2 bg-bg/40 border border-line rounded px-2 py-1 text-xs text-text focus:border-accent outline-none"
                                                    value={card.manualSetCode || ''}
                                                    onChange={(e) => handleUpdateCard(card.tempId, { manualSetCode: e.target.value })}
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Rarity"
                                                    className="w-1/2 bg-bg/40 border border-line rounded px-2 py-1 text-xs text-text focus:border-accent outline-none"
                                                    value={card.manualRarity || ''}
                                                    onChange={(e) => handleUpdateCard(card.tempId, { manualRarity: e.target.value })}
                                                />
                                            </div>
                                        ) : (
                                            <PrintingPicker
                                                printings={card.allPrintings}
                                                selectedSet={card.selectedSet}
                                                onSelect={(s) => handleUpdateCard(card.tempId, { selectedSet: s, setTouched: true })}
                                                loading={card.loadingSets}
                                            />
                                        )}

                                        <CopyChip edition={card.edition} condition={card.condition}
                                            onChange={(v) => handleUpdateCard(card.tempId, v)} />

                                        {card.setMatchConfidence === 'exact' && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-good bg-good/10 border border-good/30 rounded px-1.5 py-1" title="Set-Code aus der Karte gelesen">
                                                Erkannt
                                            </span>
                                        )}
                                        {card.setMatchConfidence === 'fuzzy' && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-warn bg-warn/10 border border-warn/30 rounded px-1.5 py-1" title="Set-Code aus unscharfem Scan wiederhergestellt — bitte überprüfen">
                                                Prüfen?
                                            </span>
                                        )}

                                        <button
                                            onClick={() => handleUpdateCard(card.tempId, { isManualEntry: !card.isManualEntry })}
                                            className={`p-1.5 rounded transition-colors ${card.isManualEntry ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-accent'}`}
                                            title="Manuelle Eingabe umschalten"
                                        >
                                            <Edit className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>

                                    {/* Extra printings of the same card (e.g. you also have the English print) */}
                                    {(card.extraPrintings || []).map((p) => (
                                        <div key={p.id} className="flex gap-2 items-center mt-2">
                                            <div className="flex items-center bg-bg/40 rounded-lg border border-line p-0.5 h-8">
                                                <button onClick={() => updatePrinting(card.tempId, p.id, { quantity: Math.max(1, (p.quantity || 1) - 1) })} className="p-1 hover:bg-surface-2 rounded text-muted"><Minus className="w-3 h-3" /></button>
                                                <span className="w-6 text-center text-xs font-mono">{p.quantity || 1}</span>
                                                <button onClick={() => updatePrinting(card.tempId, p.id, { quantity: (p.quantity || 1) + 1 })} className="p-1 hover:bg-surface-2 rounded text-muted"><Plus className="w-3 h-3" /></button>
                                            </div>
                                            <PrintingPicker
                                                printings={card.allPrintings}
                                                selectedSet={p.selectedSet}
                                                onSelect={(s) => updatePrinting(card.tempId, p.id, { selectedSet: s })}
                                                loading={card.loadingSets}
                                            />
                                            <CopyChip edition={p.edition} condition={p.condition}
                                                onChange={(v) => updatePrinting(card.tempId, p.id, v)} />
                                            <button onClick={() => removePrinting(card.tempId, p.id)} className="p-1.5 rounded bg-surface-2 text-muted hover:text-bad transition-colors" title="Druckvariante entfernen">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => addPrinting(card.tempId)}
                                        className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
                                        title="Weitere Druckvariante dieser Karte hinzufügen"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Weitere Druckvariante
                                    </button>
                            </>
                        ) : (
                             <p className="text-text font-mono">{card.passcode}</p>
                        )}
                        {card.status === 'error' && <p className="text-bad text-sm">Details konnten nicht geladen werden.</p>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 ml-4">
                        <button
                            onClick={() => handleDiscard(card.tempId)}
                            className="p-2 rounded-full hover:bg-bad/10 text-muted hover:text-bad transition-colors"
                            title="Verwerfen"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        {card.status === 'loaded' && (
                             <button
                                onClick={() => handleAdd(card.tempId)}
                                disabled={isUpdating}
                                className="flex items-center px-4 py-2 bg-surface-2 hover:bg-bg border border-line text-text rounded-lg transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                             >
                                <Check className="w-4 h-4 mr-2" />
                                Übernehmen
                             </button>
                        )}
                    </div>
                </div>
            ))}
        </div>

        {unknownCount > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg text-text mb-1">Unbekannte Karten</h2>
              <p className="text-sm text-muted mb-3">
                Karten ohne Set-Code. Ordne sie zu, bevor Preise und Set-Fortschritt stimmen.
              </p>
              <div className="flex gap-2">
                <button type="button" className="px-3 py-2 rounded-lg text-sm bg-surface-2 border border-line text-text"
                  disabled={busy} onClick={() => runUnknownAction('convert')}>Auf Standard-Set setzen</button>
                <button type="button" className="px-3 py-2 rounded-lg text-sm bg-surface-2 border border-line text-text"
                  disabled={busy} onClick={() => runUnknownAction('merge')}>Alle zusammenführen</button>
              </div>
            </section>
        )}
    </div>
  );
}
