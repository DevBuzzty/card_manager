import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import CollectionList from './components/CollectionList';
import Portfolio from './components/Portfolio';

function App() {
  const [activeTab, setActiveTab] = useState('staging');
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
            {activeTab === 'staging' && (
            <StagingArea scannedCards={scannedCards} setScannedCards={setScannedCards} isUpdating={!!updateProgress} />
            )}
            {activeTab === 'collection' && (
            <CollectionList isUpdating={!!updateProgress} setUpdateProgress={setUpdateProgress} />
            )}
            {activeTab === 'portfolio' && (
            <Portfolio />
            )}
        </div>
      </main>
    </div>
  );
}

export default App;
