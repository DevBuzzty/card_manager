import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import CollectionList from './components/CollectionList';
import Portfolio from './components/Portfolio';
import DeckBuilder from './components/DeckBuilder';
import MissingData from './components/MissingData';
import Wishlist from './components/Wishlist';
import Settings from './components/Settings';
import Dashboard from './components/Dashboard';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [scannedCards, setScannedCards] = useState([]);
  const [updateProgress, setUpdateProgress] = useState(null); // { current, total } or null

  useEffect(() => {
    if (window.api) {
      // Sound Effect Helper
      const playScanSound = () => {
          try {
              const AudioContext = window.AudioContext || window.webkitAudioContext;
              if (!AudioContext) return;

              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();

              osc.connect(gain);
              gain.connect(ctx.destination);

              // High-tech blip sound
              osc.type = 'sine';
              osc.frequency.setValueAtTime(800, ctx.currentTime);
              osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);

              gain.gain.setValueAtTime(0.1, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

              osc.start();
              osc.stop(ctx.currentTime + 0.1);
          } catch (e) {
              console.error("Audio play failed", e);
          }
      };

      // Listen for scans
      const removeScanListener = window.api.onCardScanned((data) => {
        console.log('Received scan:', data);

        playScanSound();

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
            {activeTab === 'deckbuilder' && (
            <DeckBuilder />
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
        </div>
      </main>
    </div>
  );
}

export default App;
