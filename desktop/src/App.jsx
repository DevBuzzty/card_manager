import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import SammlungLayout from './components/SammlungLayout';
import VerkaufenLayout, { KandidatenPanel, ZumVerkaufPanel, AngebotePanel, VerkaeufePanel } from './components/VerkaufenLayout';
import CollectionList from './components/CollectionList';
import Binders from './components/Binders';
import BinderView from './components/BinderView';
import Wishlist from './components/Wishlist';
import SetCompletion from './components/SetCompletion';
import SealedList from './components/SealedList';
import Settings from './components/Settings';
import Start from './components/Start';
import Deals from './components/Deals';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import CardDetailPanel from './components/CardDetailPanel';
import { applyScan } from './utils/scanAggregate.js';
import { ROUTES } from './utils/routes';

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

  // Spec-Fix I3: applyScan braucht die Voreinstellungen, um einen neu angelegten Zusatzdruck damit
  // zu belegen (wie der Kotlin-Zwilling). Ueber einen Ref statt direkt aus dem State gelesen, damit
  // der onCardScanned-Listener unten (registriert mit `[]`-Deps, siehe dort) nicht den Stand von
  // beim Mounten einfriert, sondern immer die zuletzt geladenen Voreinstellungen sieht.
  const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
  const defaultsRef = useRef(defaults);
  useEffect(() => { defaultsRef.current = defaults; }, [defaults]);
  useEffect(() => { window.api?.getDefaults?.().then(d => d && setDefaults(d)); }, []);

  useEffect(() => {
    if (window.api) {
      // Listen for scans
      const removeScanListener = window.api.onCardScanned((data) => {
        console.log('Received scan:', data);
        // Spec D4 §5: eine Wiederholung wird zusammengefasst, statt verworfen zu werden --
        // gleicher Druck erhoeht die Menge, ein anderer macht eine Zusatzzeile auf. Die Regel
        // steht in utils/scanAggregate.js, ihr Kotlin-Zwilling in ScanAggregator.kt.
        setScannedCards(prev => applyScan(prev, data, defaultsRef.current));
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

  // Spec G2 §6.2: Klick auf die Windows-Benachrichtigung -> Insights, Reiter „Alarme".
  useEffect(() => window.api?.onOpenPriceAlerts?.(() => navigate(ROUTES.insights, { state: { tab: 'alarme' } })), [navigate]);
  // H3b2: Klick auf eine eBay-Hinweis-Benachrichtigung öffnet die Angebote (Banner mit allen Hinweisen).
  useEffect(() => window.api?.onOpenSaleNotices?.(() => navigate(ROUTES.angebote)), [navigate]);

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
    <ToastProvider>
    <div className="flex h-screen bg-bg text-text overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-bg p-6 flex flex-col">
        {updateProgress && (
            <div className="bg-bg border-b border-line px-6 py-2 flex items-center justify-between text-xs text-accent animate-pulse">
                <span className="font-bold uppercase tracking-wider">Kartendaten werden aktualisiert…</span>
                <span>{updateProgress.current} / {updateProgress.total}</span>
            </div>
        )}
        <div className="flex-1 overflow-hidden flex gap-6 min-h-0">
            <div className="flex-1 min-w-0 overflow-auto">
              <ErrorBoundary>
                <Suspense fallback={<div className="flex items-center justify-center h-full text-accent"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
                  <Routes location={background || (panelOpen ? { ...location, pathname: '/sammlung/karten' } : location)}>
                    <Route path="/" element={<Navigate to="/start" replace />} />
                    <Route path="/start" element={<Start onOpenPalette={() => setPaletteOpen(true)} />} />
                    <Route path="/scannen" element={<StagingArea scannedCards={scannedCards} setScannedCards={setScannedCards} isUpdating={!!updateProgress} />} />
                    <Route path="/sammlung" element={<SammlungLayout />}>
                      <Route index element={<Navigate to="/sammlung/karten" replace />} />
                      <Route path="karten" element={<CollectionList isUpdating={!!updateProgress} setUpdateProgress={setUpdateProgress} />} />
                      <Route path="binder" element={<Binders />} />
                      {/* Ein aufgeschlagener Behälter (Spec B2 §7.2) liegt unter der Liste, damit
                          das Segment „Binder" in SammlungLayout markiert bleibt. */}
                      <Route path="binder/:containerId" element={<BinderView panelOpen={panelOpen} />} />
                      <Route path="wunschliste" element={<Wishlist />} />
                      <Route path="sets" element={<SetCompletion />} />
                      <Route path="sealed" element={<SealedList />} />
                    </Route>
                    <Route path="/decks" element={<DeckBuilder />} />
                    <Route path="/sammlung/decks" element={<Navigate to="/decks" replace />} />
                    <Route path="/verkaufen" element={<VerkaufenLayout />}>
                      <Route index element={<Navigate to="/verkaufen/kandidaten" replace />} />
                      <Route path="kandidaten" element={<KandidatenPanel />} />
                      <Route path="zum-verkauf" element={<ZumVerkaufPanel />} />
                      <Route path="angebote" element={<AngebotePanel />} />
                      <Route path="verkaeufe" element={<VerkaeufePanel />} />
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
    </ToastProvider>
  );
}

export default App;
