import React, { useEffect, useState, useRef } from 'react';
import WinningTable from './components/WinningTable';
import CheckSection from './components/CheckSection';
import GmailCheckSection from './components/GmailCheckSection';
import { WinningNumbers } from './types';
import { fetchLatestWinningNumbers, getCachedWinningNumbers, hasGeminiApiKey, FALLBACK_WINNING_NUMBERS, WinningNumbersSource } from './services/gemini';

const formatFetchedAt = (ts: number) =>
  new Date(ts).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const App: React.FC = () => {
  // 先顯示上次下載的獎號，連線更新完成後再替換，避免開啟時要等資料來源回應才能對獎
  const [winningNumbersList, setWinningNumbersList] = useState<WinningNumbers[]>(() => getCachedWinningNumbers()?.data ?? []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [offlineNotice, setOfflineNotice] = useState<{ source: Exclude<WinningNumbersSource, 'live'>; fetchedAt: number | null } | null>(null);
  const hasFetched = useRef(false);
  const selectionRef = useRef({ list: winningNumbersList, index: selectedIndex });
  selectionRef.current = { list: winningNumbersList, index: selectedIndex };

  const loadData = async (force: boolean = false) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const { data, source, fetchedAt } = await fetchLatestWinningNumbers(force);
      // 更新後保留使用者選取的期別（若新資料仍包含該期）
      const selectedPeriod = selectionRef.current.list[selectionRef.current.index]?.period;
      const keepIndex = selectedPeriod ? data.findIndex((item) => item.period === selectedPeriod) : -1;
      setWinningNumbersList(data);
      setSelectedIndex(keepIndex >= 0 ? keepIndex : 0);
      setOfflineNotice(source === 'live' ? null : { source, fetchedAt });
      if (force && source === 'live') {
        setSuccessMessage(`已更新至最新資料（最新一期：${data[0].period}）。`);
      }
    } catch (err: any) {
      console.error(err);
      // Use the specific error message thrown by the service
      setError(err.message || "無法更新號碼，請稍後再試");
      setWinningNumbersList((prev) => (prev.length > 0 ? prev : FALLBACK_WINNING_NUMBERS));
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
          <p className="text-gray-500 font-medium">輸入號碼 • 掃描 QR Code • Gmail 自動對獎</p>
        </header>

        {successMessage && (
          <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded-r shadow-sm flex items-center justify-between transition-all">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-green-800 font-bold">更新成功</p>
                <p className="text-sm text-green-700 mt-0.5">{successMessage}</p>
              </div>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-green-600 hover:text-green-800 text-sm font-semibold ml-4 p-1"
              title="關閉"
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
        )}

        {offlineNotice && !loading && (
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r shadow-sm" role="status">
            <p className="text-sm text-amber-800 font-bold">目前為離線資料，最新一期可能尚未收錄</p>
            <p className="text-sm text-amber-700 mt-1">
              {offlineNotice.source === 'cache'
                ? `無法連線至開獎資料來源，目前顯示${offlineNotice.fetchedAt ? ` ${formatFetchedAt(offlineNotice.fetchedAt)} ` : '先前'}下載的獎號`
                : '無法連線至開獎資料來源，目前顯示程式內建獎號'}
              （收錄至 {winningNumbersList[0]?.period}）。對獎前請先核對期別。
            </p>
            <button onClick={() => loadData(true)} className="mt-2 text-sm text-amber-800 underline hover:text-amber-600 font-medium">
              重試連線
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r shadow-sm flex items-start justify-between transition-all">
            <div className="flex items-start">
              <div className="flex-shrink-0 pt-0.5">
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
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 text-sm font-semibold ml-4 p-1"
              title="關閉"
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
        )}


        {/* 最常用的對獎放最上面，手機上不用先捲過整張獎號表 */}
        <CheckSection winningNumbersList={winningNumbersList} selectedIndex={selectedIndex} />

        <div className="mt-6">
          <WinningTable 
            data={currentWinningNumbers} 
            periods={periods}
            selectedIndex={selectedIndex}
            onSelectPeriod={setSelectedIndex}
            loading={loading} 
            onRefresh={() => loadData(true)}
          />
        </div>

        {/* Gmail Check */}
        <GmailCheckSection winningNumbersList={winningNumbersList} selectedIndex={selectedIndex} />
        
        <footer className="text-center mt-12 text-gray-400 text-sm">
          <p>資料來源：財政部電子發票整合服務平台</p>
          <p className="mt-1 text-xs">中獎與否請以財政部公告為準</p>
          <p className="mt-3 text-xs text-gray-500">小提醒：在手機瀏覽器的選單選「加到主畫面」，下次對獎一點就能開；沒有網路時也能用上次下載的獎號對獎。</p>
          {hasGeminiApiKey() && <p className="mt-1 text-xs">圖片辨識技術由 Google Gemini 提供</p>}
        </footer>
      </div>
    </div>
  );
};

export default App;
