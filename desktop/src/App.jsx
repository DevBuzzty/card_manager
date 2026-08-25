import { useState, useEffect, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import CollectionList from './components/CollectionList';
import MissingData from './components/MissingData';
import Wishlist from './components/Wishlist';
import Settings from './components/Settings';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';
import UnknownCards from './components/UnknownCards';
import Statistics from './components/Statistics';

// Heavy tabs (recharts / large deck UI) are code-split so the initial load stays light.
const Portfolio = lazy(() => import('./components/Portfolio'));
const DeckBuilder = lazy(() => import('./components/DeckBuilder'));

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [scannedCards, setScannedCards] = useState([]);
  const [updateProgress, setUpdateProgress] = useState(null); // { current, total } or null

  useEffect(() => {
    if (window.api) {
      // Listen for scans
      const removeScanListener = window.api.onCardScanned((data) => {
        console.log('Received scan:', data);
        // Add to beginning of list with a unique temp ID
        setScannedCards(prev => {
            // Check for duplicates in current staging
            if (prev.some(c => c.passcode === data.passcode)) {
                return prev;
            }

            return [{
                tempId: Date.now() + Math.random(),
                passcode: data.passcode,
                status: 'pending',
                data: null
            }, ...prev];
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

  return (
    <div className="flex h-screen bg-space-black text-space-white overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-auto bg-space-black p-6 flex flex-col">
        {updateProgress && (
            <div className="bg-gray-900 border-b border-gray-800 px-6 py-2 flex items-center justify-between text-xs text-space-violet animate-pulse">
                <span className="font-bold uppercase tracking-wider">Updating Card Database...</span>
                <span>{updateProgress.current} / {updateProgress.total}</span>
            </div>
        )}
        <div className="flex-1 overflow-auto">
            <ErrorBoundary>
              <Suspense fallback={<div className="flex items-center justify-center h-full text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
                {activeTab === 'dashboard' && (
                <Dashboard setActiveTab={setActiveTab} />
                )}
                {activeTab === 'staging' && (
                <StagingArea scannedCards={scannedCards} setScannedCards={setScannedCards} isUpdating={!!updateProgress} />
                )}
                {activeTab === 'collection' && (
                <CollectionList isUpdating={!!updateProgress} setUpdateProgress={setUpdateProgress} />
                )}
                {activeTab === 'portfolio' && (
                <Portfolio />
                )}
                {activeTab === 'statistics' && (
                <Statistics />
                )}
                {activeTab === 'deckbuilder' && (
                <DeckBuilder />
                )}
                {activeTab === 'unknown' && (
                <UnknownCards />
                )}
                {activeTab === 'missing' && (
                <MissingData />
                )}
                {activeTab === 'wishlist' && (
                <Wishlist />
                )}
                {activeTab === 'settings' && (
                <Settings />
                )}
              </Suspense>
            </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default App;
