import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import StagingArea from './components/StagingArea';
import CollectionList from './components/CollectionList';

function App() {
  const [activeTab, setActiveTab] = useState('staging');
  const [scannedCards, setScannedCards] = useState([]);

  useEffect(() => {
    // Listen for scans
    if (window.api) {
      const removeListener = window.api.onCardScanned((data) => {
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
      return () => removeListener();
    }
  }, []);

  return (
    <div className="flex h-screen bg-space-black text-space-white overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-auto bg-space-black p-6">
        {activeTab === 'staging' && (
          <StagingArea scannedCards={scannedCards} setScannedCards={setScannedCards} />
        )}
        {activeTab === 'collection' && (
          <CollectionList />
        )}
      </main>
    </div>
  );
}

export default App;
