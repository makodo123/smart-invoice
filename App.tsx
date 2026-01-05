import React, { useEffect, useState, useRef } from 'react';
import WinningTable from './components/WinningTable';
import CheckSection from './components/CheckSection';
import GmailCheckSection from './components/GmailCheckSection';
import { WinningNumbers } from './types';
import { fetchLatestWinningNumbers } from './services/gemini';

const App: React.FC = () => {
  const [winningNumbersList, setWinningNumbersList] = useState<WinningNumbers[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const loadData = async (force: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLatestWinningNumbers(force);
      setWinningNumbersList(data);
      setSelectedIndex(0);
    } catch (err: any) {
      console.error(err);
      // Use the specific error message thrown by the service
      setError(err.message || "無法更新號碼，請稍後再試");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Prevent double fetch in React Strict Mode (dev environment)
    if (hasFetched.current) return;
    hasFetched.current = true;
    
    // Initial load without forcing (uses cache if available)
    loadData(false);
  }, []);

  const currentWinningNumbers = winningNumbersList.length > 0 ? winningNumbersList[selectedIndex] : null;
  const periods = winningNumbersList.map(w => w.period);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-8 pt-4">
          <h1 className="text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 mb-2">
            統一發票智能對獎
          </h1>
          <p className="text-gray-500 font-medium">官方即時更新 • AI 圖片辨識 • 快速兌獎</p>
        </header>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r shadow-sm">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-700 font-bold">更新失敗</p>
                <p className="text-sm text-red-600 mt-1">{error}</p>
                <button onClick={() => loadData(true)} className="mt-2 text-sm text-red-700 underline hover:text-red-600 font-medium">
                  重試連線
                </button>
              </div>
            </div>
          </div>
        )}

        <WinningTable 
          data={currentWinningNumbers} 
          periods={periods}
          selectedIndex={selectedIndex}
          onSelectPeriod={setSelectedIndex}
          loading={loading} 
          onRefresh={() => loadData(true)}
        />

        {/* Manual & Camera Check */}
        <CheckSection winningNumbersList={winningNumbersList} />

        {/* Gmail Check */}
        <GmailCheckSection winningNumbersList={winningNumbersList} selectedIndex={selectedIndex} />
        
        <footer className="text-center mt-12 text-gray-400 text-sm">
          <p>資料來源：財政部電子發票整合服務平台</p>
          <p className="mt-1 text-xs">圖片辨識技術由 Google Gemini 提供</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
