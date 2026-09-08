import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import SammlungLayout from './components/SammlungLayout';
import CollectionList from './components/CollectionList';
import Wishlist from './components/Wishlist';
import SetCompletion from './components/SetCompletion';
import Settings from './components/Settings';
import Start from './components/Start';
import Deals from './components/Deals';
import ErrorBoundary from './components/ErrorBoundary';
import CardDetailPanel from './components/CardDetailPanel';

// Heavy tabs are code-split so the initial load stays light.
const Insights = lazy(() => import('./components/Insights'));
const DeckBuilder = lazy(() => import('./components/DeckBuilder'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));

function App() {
  const [scannedCards, setScannedCards] = useState([]);
  const [updateProgress, setUpdateProgress] = useState(null); // { current, total } or null
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const panelOpen = /^\/karte\//.test(location.pathname);
  // A background that is itself a card route would make <Routes> match nothing and bounce the
  // user to /start — ignore it and fall back to the panel's default background.
  const rawBackground = location.state?.background;
  const background = /^\/karte\//.test(rawBackground?.pathname || '') ? undefined : rawBackground;

  useEffect(() => {
    if (window.api) {
      // Listen for scans
      const removeScanListener = window.api.onCardScanned((data) => {
        console.log('Received scan:', data);
        // Append to the END so the first-scanned card stays at the top (a newly-added card grows
        // the list downward, so its expanded rows can't get clipped off the bottom).
        setScannedCards(prev => {
            // Check for duplicates in current staging
            if (prev.some(c => c.passcode === data.passcode)) {
                return prev;
            }

            // Spec D3 Task 8: the phone already resolved set code, rarity, language, edition and
            // the traffic light from evidence the desktop never saw (the card's own band text) --
            // `scannedConfidence` (present only from an updated phone) is the signal StagingArea
            // uses to take that conclusion as-is instead of re-matching scannedSetCandidates
            // itself. An older phone build never sends these fields, so they land `undefined`
            // here and StagingArea falls back to its existing local matching (see its own
            // comment on that fallback).
            return [...prev, {
                tempId: Date.now() + Math.random(),
                passcode: data.passcode,
                scannedSetCandidates: data.setCodeCandidates || (data.setCode ? [data.setCode] : []),
                scannedSetCode: data.setCode,
                scannedRarity: data.rarity,
                scannedLanguage: data.language,
                scannedEdition: data.edition,
                scannedEditionConfidence: data.editionConfidence,
                scannedConfidence: data.confidence,
                scannedReason: data.reason,
                status: 'pending',
                data: null
            }];
        });
      });

      // Listen for progress
      const removeProgressListener = window.api.onUpdateProgress((data) => {
          setUpdateProgress(data);
          // Auto-clear when done
          if (data && data.current >= data.total) {
              setTimeout(() => {
                  setUpdateProgress(null);
              }, 1000);
          }
      });

      return () => {
          removeScanListener();
          removeProgressListener();
      };
    }
  }, []);

  // Cmd/Ctrl+K opens the palette; Alt+Arrow walks the history like a browser (Electron's
  // mouse back/forward buttons already drive the same history).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
    };
    const onMouse = (e) => {
      if (e.button === 3) { e.preventDefault(); navigate(-1); }
      if (e.button === 4) { e.preventDefault(); navigate(1); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse); };
  }, [navigate]);

  return (
    <div className="flex h-screen bg-obsidian text-ink overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-obsidian p-6 flex flex-col">
        {updateProgress && (
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-2 flex items-center justify-between text-xs text-space-violet animate-pulse">
                <span className="font-bold uppercase tracking-wider">Kartendaten werden aktualisiert…</span>
                <span>{updateProgress.current} / {updateProgress.total}</span>
            </div>
        )}
        <div className="flex-1 overflow-hidden flex gap-6 min-h-0">
            <div className="flex-1 min-w-0 overflow-auto">
              <ErrorBoundary>
                <Suspense fallback={<div className="flex items-center justify-center h-full text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
                  <Routes location={background || (panelOpen ? { ...location, pathname: '/sammlung/karten' } : location)}>
                    <Route path="/" element={<Navigate to="/start" replace />} />
                    <Route path="/start" element={<Start onOpenPalette={() => setPaletteOpen(true)} />} />
                    <Route path="/scannen" element={<StagingArea scannedCards={scannedCards} setScannedCards={setScannedCards} isUpdating={!!updateProgress} />} />
                    <Route path="/sammlung" element={<SammlungLayout />}>
                      <Route index element={<Navigate to="/sammlung/karten" replace />} />
                      <Route path="karten" element={<CollectionList isUpdating={!!updateProgress} setUpdateProgress={setUpdateProgress} />} />
                      <Route path="wunschliste" element={<Wishlist />} />
                      <Route path="sets" element={<SetCompletion />} />
                      <Route path="decks" element={<DeckBuilder />} />
                    </Route>
                    <Route path="/deals" element={<Deals />} />
                    <Route path="/insights" element={<Insights />} />
                    <Route path="/einstellungen" element={<Navigate to="/einstellungen/konto" replace />} />
                    <Route path="/einstellungen/:bereich" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/start" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
            {panelOpen && (
              <ErrorBoundary>
                {/* The panel sits beside the page instead of replacing it, so it needs a
                    <Routes> of its own: outside a matched route useParams() is empty, the
                    panel looks up the printing key "Unknown" and renders nothing. */}
                <Routes>
                  <Route path="/karte/:id/:setCode/:language/:rarity"
                         element={<CardDetailPanel paletteOpen={paletteOpen} />} />
                </Routes>
              </ErrorBoundary>
            )}
        </div>
      </main>
      <Suspense fallback={null}>
        {paletteOpen && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />}
      </Suspense>
    </div>
  );
}

export default App;
