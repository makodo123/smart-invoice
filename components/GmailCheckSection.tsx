import React, { useState, useEffect } from 'react';
import { WinningNumbers, CheckResult, PrizeType, HistoryItem } from '../types';
import { checkInvoice } from '../utils/checkLogic';
import { saveHistoryItem, saveHistoryList, getHistory } from '../utils/storage';
import { initTokenClient, requestAccessToken, fetchInvoiceEmails, fetchMessageDetails, GmailMessage } from '../services/gmail';

interface Props {
  winningNumbersList: WinningNumbers[];
  selectedIndex: number;
}

// TODO: 為了讓體驗更順暢，您可以直接將 Client ID 貼在這裡
// 例如: const HARDCODED_CLIENT_ID = "123456789-abcde.apps.googleusercontent.com";
const HARDCODED_CLIENT_ID = "";

const GmailCheckSection: React.FC<Props> = ({ winningNumbersList, selectedIndex }) => {
  const [clientId, setClientId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scannedCount, setScannedCount] = useState(0);
  const [results, setResults] = useState<{msg: GmailMessage, check: CheckResult}[]>([]);
  const [scannedLog, setScannedLog] = useState<{msg: GmailMessage, check: CheckResult}[]>([]);
  
  // UI States
  const [needsConfig, setNeedsConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  // Initialize: Check LocalStorage or Hardcoded ID
  useEffect(() => {
    const savedId = localStorage.getItem('google_client_id');
    const finalId = HARDCODED_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || savedId || '';
    
    if (finalId) {
      setClientId(finalId);
      // Try to init immediately if we have an ID
      try {
        initTokenClient(finalId, (token) => {
          setIsLoggedIn(true);
        });
      } catch (e) {
        console.error("Auto-init failed", e);
      }
    } else {
      setNeedsConfig(true);
      setShowHelp(true); // Show help by default if no ID
    }
  }, []);

  const handleLoginClick = () => {
    if (!clientId) {
      setNeedsConfig(true);
      setShowHelp(true);
      return;
    }

    // Save for future
    if (clientId !== HARDCODED_CLIENT_ID) {
      localStorage.setItem('google_client_id', clientId);
    }

    try {
      // Re-init to be safe, then request
      initTokenClient(clientId, (token) => {
        setIsLoggedIn(true);
        startScanning(); // Auto start scanning after login
      });
      requestAccessToken();
      setNeedsConfig(false);
      setShowHelp(false);
    } catch (e) {
      alert("初始化失敗，請確認 Client ID 格式正確，或參考下方說明");
      console.error(e);
      setNeedsConfig(true);
      setShowHelp(true);
    }
  };

  /**
   * Helper to parse "112年 09-10月" into strict Date objects for filtering
   */
  const getSearchRange = (list: WinningNumbers[]) => {
    if (!list || list.length === 0) return null;

    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    list.forEach(item => {
        // Expected format: "112年 09-10月"
        // ROC Year = 1911 + 112 = 2023
        const yearMatch = item.period.match(/(\d{2,4})\s*年/);
        const monthMatch = item.period.match(/(\d{1,2})\s*[-~～－至]\s*(\d{1,2})\s*月/);

        if (yearMatch && monthMatch) {
            const rawYear = parseInt(yearMatch[1], 10);
            const startMonth = parseInt(monthMatch[1]);
            const endMonth = parseInt(monthMatch[2]);
            const fullYear = rawYear >= 1911 ? rawYear : 1911 + rawYear;

            // Start Date: 1st day of start month at 00:00:00
            const currentStart = new Date(fullYear, startMonth - 1, 1);
            // End Date: Last day of end month at 23:59:59 (using day 0 of next month)
            const currentEnd = new Date(fullYear, endMonth, 0); 
            currentEnd.setHours(23, 59, 59, 999);

            if (!minDate || currentStart < minDate) minDate = currentStart;
            if (!maxDate || currentEnd > maxDate) maxDate = currentEnd;
        }
    });

    if (minDate && maxDate) {
        const minD = minDate as Date;
        const maxD = maxDate as Date;

        // For API Query (Add small buffer for query to be safe)
        const apiAfter = new Date(minD);
        apiAfter.setDate(apiAfter.getDate() - 5);
        
        const apiBefore = new Date(maxD);
        apiBefore.setDate(apiBefore.getDate() + 5);

        // Format to YYYY/MM/DD for API
        const toStr = (d: Date) => `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
        
        return {
            apiQueryAfter: toStr(apiAfter),
            apiQueryBefore: toStr(apiBefore),
            // Precise timestamps for client-side filtering
            minTimestamp: minD.getTime(),
            // Allow +2 days grace period in client filter for email delivery delays vs invoice date
            maxTimestamp: maxD.getTime() + (2 * 24 * 60 * 60 * 1000), 
            label: `${toStr(minD)} ~ ${toStr(maxD)}`
        };
    }
    return null;
  };

  const getScanPeriods = (list: WinningNumbers[], index: number) => {
    if (!list || list.length === 0) return [];
    const start = Math.min(Math.max(index, 0), list.length - 1);
    return list.slice(start, start + 2);
  };

  const scanPeriods = getScanPeriods(winningNumbersList, selectedIndex);

  const startScanning = async () => {
    if (scanPeriods.length === 0) {
      alert("請先等待中獎號碼載入");
      return;
    }

    setIsScanning(true);
    setResults([]);
    setScannedLog([]);
    setScannedCount(0);

    const range = getSearchRange(scanPeriods);
    let query = "label:電子發票";
    let rangeLabel = "自動偵測日期";

    if (range) {
        // Query API with a slightly wider buffer to ensure we don't miss edge cases
        query += ` after:${range.apiQueryAfter} before:${range.apiQueryBefore}`;
        rangeLabel = range.label;
    }

    setScanProgress(`正在搜尋「${rangeLabel}」的發票...`);

    try {
      // Fetch up to 2000 emails, allowing pagination to search deep
      const messages = await fetchInvoiceEmails(query, 2000); 
      
      if (messages.length === 0) {
        setScanProgress(`在區間 ${rangeLabel} 找不到標籤為「電子發票」的郵件`);
        setIsScanning(false);
        return;
      }

      setScanProgress(`找到 ${messages.length} 封相關郵件，開始過濾與解析...`);
      
      let processed = 0;
      let validDateCount = 0;
      const newHistoryItems: HistoryItem[] = [];
      const currentHistory = getHistory();
      
      for (const msg of messages) {
        processed++;
        // Update progress occasionally
        if (processed % 10 === 0) {
             setScanProgress(`正在處理 (${processed}/${messages.length})，符合日期: ${validDateCount} 封...`);
        }
        
        const details = await fetchMessageDetails(msg.id);
        
        if (details) {
            // --- STRICT CLIENT-SIDE FILTERING ---
            // Gmail API's before/after isn't always 100% precise or might include threads.
            // We strictly hide anything outside the winning numbers' months.
            const emailTs = parseInt(details.internalDate);
            if (range) {
                if (emailTs < range.minTimestamp || emailTs > range.maxTimestamp) {
                    // Skip this email entirely from the log and check
                    continue; 
                }
            }
            validDateCount++;

            let bestResult: CheckResult = { isMatch: false, prizeType: PrizeType.None, amount: 0 };
            const logMsg = details.parsedNumber ? details : { ...details, fullNumber: '未解析' };

            if (details.parsedNumber) {
                for (let i = 0; i < scanPeriods.length; i++) {
                    const res = checkInvoice(details.parsedNumber, scanPeriods[i], i === 0);
                    if (res.isMatch) {
                        bestResult = res;
                        break; 
                    }
                }

                if (bestResult.isMatch) {
                    setResults(prev => [...prev, { msg: details, check: bestResult }]);
                    
                    const exists = currentHistory.some(h => h.number === details.parsedNumber);
                    if (!exists) {
                        newHistoryItems.push({
                            id: Date.now().toString() + Math.random(),
                            number: details.parsedNumber,
                            timestamp: parseInt(details.internalDate),
                            result: bestResult
                        });
                    }
                }
            }

            // Add to log if it passed the date filter
            setScannedLog(prev => [...prev, { msg: logMsg, check: bestResult }]);
            setScannedCount(prev => prev + 1);
        }
        
        // Slight delay
        await new Promise(r => setTimeout(r, 5));
      }

      if (newHistoryItems.length > 0) {
          saveHistoryList([...newHistoryItems, ...currentHistory].slice(0, 50));
      }

      setScanProgress(`掃描完成！篩選後共 ${validDateCount} 封符合 ${rangeLabel} 區間，發現 ${results.length} 張中獎發票。`);

    } catch (e: any) {
      console.error(e);
      setScanProgress(`發生錯誤: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const formatDate = (timestamp: string) => {
    try {
      const date = new Date(parseInt(timestamp));
      return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return '';
    }
  };

  const rangeInfo = getSearchRange(scanPeriods);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100 mt-6">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h3 className="text-xl font-bold text-gray-800 flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-red-500"><path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/></svg>
          Gmail 自動兌獎
        </h3>
        
        <div className="flex space-x-2">
            <button 
                onClick={() => setShowHelp(!showHelp)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${showHelp ? 'bg-blue-100 text-blue-700 border-blue-200' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}
            >
                {showHelp ? '隱藏教學' : '設定教學 / 無法登入？'}
            </button>
            <button 
                onClick={() => setNeedsConfig(!needsConfig)}
                className="text-gray-400 hover:text-gray-600 p-1"
                title="修改 Client ID"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
        </div>
      </div>

      {/* Troubleshooting Guide */}
      {showHelp && (
        <div className="bg-blue-50 p-5 rounded-xl mb-6 text-sm text-blue-900 border border-blue-200 animate-fade-in">
            <h4 className="font-bold text-base mb-3 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                如何解決 400 redirect_uri_mismatch 錯誤？
            </h4>
            <div className="space-y-3 pl-1">
                <p>這個錯誤表示 Google 後台尚未允許您目前的網站網址。請依照以下步驟修復：</p>
                <ol className="list-decimal list-inside space-y-1.5 ml-1 text-blue-800">
                    <li>前往 <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline font-bold hover:text-blue-600">Google Cloud Console 憑證頁面</a>。</li>
                    <li>點擊您建立的 <strong>OAuth 2.0 Client ID</strong>。</li>
                    <li>找到 <strong>Authorized JavaScript origins (已授權的 JavaScript 來源)</strong> 區塊。</li>
                    <li>點擊「ADD URI (新增 URI)」並貼上以下網址（不要有斜線結尾）：</li>
                </ol>
                <div className="flex items-center gap-2 my-2 bg-white p-2 rounded border border-blue-200 shadow-sm max-w-md">
                    <code className="font-mono text-blue-600 flex-grow select-all font-bold">
                        {currentOrigin}
                    </code>
                     <button 
                        onClick={() => {
                            navigator.clipboard.writeText(currentOrigin);
                            alert("已複製網址！請貼到 Google Console 中。");
                        }} 
                        className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-md font-medium transition-colors"
                     >
                        複製
                    </button>
                </div>
                <p className="text-xs bg-blue-100/50 p-2 rounded text-blue-700">
                    <strong>重要提示：</strong> 設定儲存後，Google 系統通常需要 <strong>5 ~ 10 分鐘</strong> 才會生效。如果剛剛才新增，請稍後再試。
                </p>
            </div>
        </div>
      )}

      {/* Config Panel */}
      {needsConfig && (
        <div className="bg-orange-50 p-4 rounded-xl mb-4 border border-orange-200 animate-fade-in">
           <h4 className="text-sm font-bold text-orange-800 mb-2">設定 Google Client ID</h4>
           <p className="text-xs text-orange-700 mb-2">請輸入您的 Google Cloud OAuth Client ID (Web Application 類型)</p>
           <input 
             type="text" 
             value={clientId}
             onChange={(e) => setClientId(e.target.value)}
             placeholder="例如: 123456789...apps.googleusercontent.com"
             className="w-full p-2.5 border border-orange-300 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-orange-200 outline-none"
           />
           <div className="flex justify-end">
               <button 
                 onClick={() => {
                     setNeedsConfig(false);
                     localStorage.setItem('google_client_id', clientId);
                 }}
                 className="text-xs bg-orange-200 hover:bg-orange-300 text-orange-800 px-4 py-1.5 rounded-lg font-medium transition-colors"
               >
                 儲存設定
               </button>
           </div>
        </div>
      )}

      {!isLoggedIn ? (
         <button
            onClick={handleLoginClick}
            className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center transition-all shadow-sm hover:shadow-md active:scale-[0.99]"
         >
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5 mr-3" alt="Google" />
            連結 Gmail 並自動兌獎
         </button>
      ) : (
         <div>
            {!isScanning && (
               <button
                  onClick={startScanning}
                  className="w-full bg-red-600 text-white hover:bg-red-700 font-bold py-3.5 px-4 rounded-xl transition-all shadow-md active:scale-[0.99] flex items-center justify-center"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16l5 5"/><path d="M21 21v-5h-5"/></svg>
                  再次掃描 (標籤: 電子發票)
               </button>
            )}

            {isScanning && (
                <div className="text-center py-6 bg-gray-50 rounded-xl border border-gray-100">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto mb-3"></div>
                    <p className="text-sm text-gray-600 font-medium">{scanProgress}</p>
                </div>
            )}
            
            {!isScanning && rangeInfo && (
                <div className="mt-2 text-center text-xs text-gray-400">
                    將只顯示 {rangeInfo.label} 期間的發票
                </div>
            )}
         </div>
      )}

      {/* Winners List (Top Priority) */}
      {results.length > 0 && (
         <div className="mt-6 space-y-3 animate-fade-in">
            <h4 className="font-bold text-gray-700 flex items-center">
                <span className="bg-red-500 w-2 h-5 rounded-full mr-2"></span>
                中獎結果 ({results.length})
            </h4>
            {results.map((item, idx) => (
                <div key={idx} className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-orange-200 p-4 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center shadow-sm gap-3">
                    <div className="overflow-hidden w-full">
                        <div className="flex items-center gap-2 mb-1">
                           <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-md font-medium">
                             {formatDate(item.msg.internalDate)}
                           </span>
                           {item.msg.fullNumber && item.msg.fullNumber !== item.msg.parsedNumber ? (
                               <span className="text-xs text-gray-500 font-mono border border-gray-200 px-1 rounded">
                                   含字軌
                               </span>
                           ) : null}
                        </div>
                        <div className="font-bold text-gray-800 text-xl font-mono tracking-wider flex items-center">
                           {item.msg.fullNumber || item.msg.parsedNumber}
                        </div>
                        <div className="text-xs text-gray-500 truncate max-w-full sm:max-w-[250px] mt-1">{item.msg.subject}</div>
                    </div>
                    <div className="text-right flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-0 pt-2 sm:pt-0 border-orange-200">
                        <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-lg font-bold shadow-sm mb-0 sm:mb-1">
                            {item.check.prizeType}
                        </span>
                        <div className="text-sm text-red-600 font-extrabold ml-auto sm:ml-0">
                           ${item.check.amount?.toLocaleString()}
                        </div>
                    </div>
                </div>
            ))}
         </div>
      )}
      
      {/* Full Scanned Log */}
      {scannedLog.length > 0 && (
        <div className="mt-8 animate-fade-in">
            <h4 className="font-bold text-gray-700 mb-3 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-gray-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                本次掃描明細 (只顯示 {rangeInfo?.label} 期間)
            </h4>
            <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                    <table className="min-w-full text-sm text-left">
                        <thead className="bg-gray-100 text-gray-600 font-medium sticky top-0 z-10">
                            <tr>
                                <th className="px-4 py-2 w-24">日期</th>
                                <th className="px-4 py-2 w-36">發票號碼</th>
                                <th className="px-4 py-2">主旨</th>
                                <th className="px-4 py-2 w-24 text-right">結果</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {scannedLog.map((item, idx) => (
                                <tr key={idx} className={`hover:bg-gray-50 transition-colors ${item.check.isMatch ? "bg-red-50 hover:bg-red-100" : ""}`}>
                                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                                        {formatDate(item.msg.internalDate)}
                                    </td>
                                    <td className="px-4 py-3 font-mono font-medium text-gray-800">
                                        {item.msg.fullNumber || item.msg.parsedNumber}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 truncate max-w-[150px] text-xs">
                                        {item.msg.subject}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {item.check.isMatch ? (
                                            <span className="text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded-full">{item.check.prizeType}</span>
                                        ) : (
                                            <span className="text-gray-400 text-xs">未中獎</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {scannedCount > 0 && results.length === 0 && (
                 <div className="mt-2 text-center text-xs text-gray-400">
                     已掃描 {scannedCount} 封符合日期的郵件，未發現中獎發票
                 </div>
            )}
        </div>
      )}

    </div>
  );
};

export default GmailCheckSection;
