import React, { useState, useRef, useEffect } from 'react';
import { WinningNumbers, CheckResult, PrizeType, HistoryItem, InvoiceData } from '../types';
import { checkInvoice } from '../utils/checkLogic';
import { analyzeInvoice } from '../services/gemini';
import { compressImage } from '../utils/imageUtils';
import { exportToCSV } from '../utils/export';
import { getHistory, saveHistoryItem, saveHistoryList, clearHistory, saveInvoiceData, getInvoiceData, clearInvoiceData } from '../utils/storage';

interface Props {
  winningNumbersList: WinningNumbers[]; 
}

const CheckSection: React.FC<Props> = ({ winningNumbersList }) => {
  const [inputNum, setInputNum] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [scannedData, setScannedData] = useState<InvoiceData | null>(null); // New: Store scanned details
  const [isScanning, setIsScanning] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [invoiceList, setInvoiceList] = useState<InvoiceData[]>([]); // New: Full data history
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkPeriods = winningNumbersList.slice(0, 2);

  useEffect(() => {
    setHistory(getHistory());
    setInvoiceList(getInvoiceData());
  }, []);

  const performCheck = (num: string): CheckResult => {
    if (checkPeriods.length === 0) {
        return { isMatch: false, prizeType: PrizeType.None, amount: 0 };
    }

    let bestResult: CheckResult | null = null;

    for (let i = 0; i < checkPeriods.length; i++) {
        const winning = checkPeriods[i];
        const isCurrent = i === 0;
        const res = checkInvoice(num, winning, isCurrent);

        if (res.isMatch) {
            if (!bestResult) {
                bestResult = res;
            } else {
                const bestIsPartial = bestResult.isPartial || false;
                const currentIsPartial = res.isPartial || false;

                if (bestIsPartial && !currentIsPartial) {
                     bestResult = res; 
                } else if (!bestIsPartial && !currentIsPartial) {
                     if ((res.amount || 0) > (bestResult.amount || 0)) {
                         bestResult = res;
                     }
                }
            }
        }
    }

    if (bestResult) return bestResult;
    return checkInvoice(num, checkPeriods[0], true);
  };

  useEffect(() => {
    if (inputNum && inputNum.length >= 3 && checkPeriods.length > 0) {
      const res = performCheck(inputNum);
      setResult(res);
    }
  }, [winningNumbersList]);

  // Auto-save history when input changes (Debounced) - Only saves basic check history
  useEffect(() => {
    if (!inputNum || inputNum.length < 3 || checkPeriods.length === 0) return;

    const timer = setTimeout(() => {
       const res = performCheck(inputNum);
       
       setHistory(prevHistory => {
         const lastItem = prevHistory[0];
         let newHistory;

         if (lastItem && inputNum.startsWith(lastItem.number) && inputNum.length > lastItem.number.length) {
            const updatedItem = { ...lastItem, number: inputNum, result: res, timestamp: Date.now() };
            newHistory = [updatedItem, ...prevHistory.slice(1)];
         } else if (lastItem && lastItem.number === inputNum) {
            return prevHistory;
         } else {
            const newItem: HistoryItem = { id: Date.now().toString(), number: inputNum, timestamp: Date.now(), result: res };
            newHistory = [newItem, ...prevHistory].slice(0, 50);
         }
         
         saveHistoryList(newHistory);
         return newHistory;
       });

    }, 500); 

    return () => clearTimeout(timer);
  }, [inputNum, winningNumbersList]);

  const addToHistory = (num: string, res: CheckResult, details?: InvoiceData) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      number: num,
      timestamp: Date.now(),
      result: res
    };
    const updatedHistory = saveHistoryItem(newItem);
    setHistory(updatedHistory);

    if (details) {
      const updatedList = saveInvoiceData(details);
      setInvoiceList(updatedList);
    }
  };

  const handleManualCheck = (num: string) => {
    setInputNum(num);
    setScannedData(null); // Clear scanned details on manual input
    if (checkPeriods.length === 0) return;
    
    if (num.length >= 3) {
      setResult(performCheck(num));
    } else {
      setResult(null);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (checkPeriods.length === 0) {
      alert("請先等待中獎號碼載入");
      return;
    }

    setIsScanning(true);
    setResult(null);
    setScannedData(null);
    setInputNum('');

    try {
      // 1. Compress Image
      const base64Data = await compressImage(file, 1024, 0.8);
      
      // 2. AI Analysis
      const data = await analyzeInvoice(base64Data, file.type);
      
      if (data && data.invoiceNumber) {
        setInputNum(data.invoiceNumber);
        setScannedData(data);
        const res = performCheck(data.invoiceNumber);
        setResult(res);
        addToHistory(data.invoiceNumber, res, data);
      } else {
        setResult({ isMatch: false, prizeType: PrizeType.None, description: "無法辨識號碼，請手動輸入" });
      }
    } catch (err) {
      console.error(err);
      alert("掃描失敗，請重試");
    } finally {
      setIsScanning(false);
    }
  };

  const getResultColor = (res: CheckResult) => {
    if (res.isPartial) return 'bg-orange-100 text-orange-800 border-2 border-orange-300';
    switch (res.prizeType) {
      case PrizeType.Special:
      case PrizeType.Grand:
      case PrizeType.First:
        return 'bg-red-500 text-white';
      case PrizeType.None:
        return 'bg-gray-100 text-gray-500';
      default:
        return 'bg-yellow-400 text-yellow-900';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
      <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-indigo-600"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        快速對獎 & 記帳
      </h3>

      {/* Input Area */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <form onSubmit={handleManualSubmit} className="relative flex-grow">
          <input
            type="tel"
            value={inputNum}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 8);
              handleManualCheck(val);
            }}
            placeholder="請輸入發票後 3 碼或全碼"
            className="w-full text-center text-3xl font-mono tracking-widest py-4 rounded-xl border-2 border-indigo-100 focus:border-indigo-500 focus:ring focus:ring-indigo-200 transition-all outline-none text-gray-700 placeholder:text-xl placeholder:text-gray-300"
            disabled={winningNumbersList.length === 0 || isScanning}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center space-x-2">
            {inputNum && (
              <button 
                type="button"
                onClick={() => { setInputNum(''); setResult(null); setScannedData(null); }}
                className="text-gray-400 hover:text-gray-600 p-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
          </div>
        </form>

        <div className="flex-shrink-0">
          <input 
            type="file" 
            accept="image/*" 
            capture="environment"
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={winningNumbersList.length === 0 || isScanning}
            className={`w-full md:w-auto h-full flex items-center justify-center px-8 py-4 rounded-xl font-bold transition-all shadow-sm ${
              isScanning 
                ? 'bg-gray-100 text-gray-400 cursor-wait'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
            }`}
          >
            {isScanning ? (
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                智能掃描
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Result Display */}
      {result && (
        <div className={`rounded-xl p-6 text-center transition-all duration-300 transform ${getResultColor(result)}`}>
          {result.isMatch ? (
            <div>
               {result.period && (
                   <div className="inline-block mb-3 px-3 py-1 rounded-full bg-black/20 text-white/90 text-sm font-bold backdrop-blur-sm">
                       {result.period} {result.isCurrentPeriod ? '(當期)' : '(前一期)'}
                   </div>
               )}
              <div className="text-3xl font-bold mb-2">
                  {result.isPartial ? '⚠️ 注意！疑似中獎' : '🎉 恭喜中獎！'}
              </div>
              <div className="text-xl opacity-90">{result.prizeType}</div>
              {result.matchedNumber && <div className="mt-4 font-mono font-bold bg-white/20 inline-block px-4 py-1 rounded">號碼：{result.matchedNumber}</div>}
            </div>
          ) : (
            <div>
              <div className="text-lg font-bold">😔 沒中獎</div>
              <div className="text-sm mt-1">{result.description || "再接再厲，下一張會更好！"}</div>
            </div>
          )}
          
          {/* Scanned Details Info */}
          {scannedData && (
            <div className="mt-4 pt-4 border-t border-black/10 text-left bg-white/10 rounded p-3 text-sm">
              <div className="flex justify-between items-center mb-1">
                <span className="opacity-70">消費日期：</span>
                <span className="font-medium">{scannedData.date}</span>
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="opacity-70">商家名稱：</span>
                <span className="font-medium">{scannedData.storeName || '未知'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="opacity-70">消費金額：</span>
                <span className="font-bold text-lg">${scannedData.amount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History & Export */}
      {history.length > 0 && (
        <div className="mt-8 border-t border-gray-100 pt-6">
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-bold text-gray-700 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-gray-500"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              歷史紀錄
            </h4>
            <div className="flex gap-3">
              {invoiceList.length > 0 && (
                <button 
                  onClick={() => exportToCSV(invoiceList)} 
                  className="text-xs bg-green-50 text-green-600 hover:bg-green-100 px-3 py-1 rounded transition-colors flex items-center"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                  匯出 Excel
                </button>
              )}
              <button 
                onClick={() => { clearHistory(); clearInvoiceData(); setHistory([]); setInvoiceList([]); }} 
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                清除全部
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {history.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg text-sm border border-transparent hover:border-gray-200 transition-colors">
                  <div className="flex flex-col">
                       <span className="font-mono font-medium text-gray-800 text-lg tracking-wider">{item.number}</span>
                       <div className="flex items-center gap-2 mt-0.5">
                           <span className="text-xs text-gray-400">{formatTime(item.timestamp)}</span>
                       </div>
                  </div>
                  <div>
                      {item.result.isMatch ? (
                           <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${item.result.isPartial ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                               {item.result.isPartial ? '核對全碼' : item.result.prizeType.split(' ')[0]}
                           </span>
                      ) : (
                           <span className="bg-gray-200 text-gray-500 px-3 py-1 rounded-full text-xs">未中獎</span>
                      )}
                  </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckSection;
