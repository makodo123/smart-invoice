import React, { useState, useRef, useEffect } from 'react';
import { WinningNumbers, CheckResult, PrizeType, HistoryItem } from '../types';
import { checkInvoice } from '../utils/checkLogic';
import { extractInvoiceNumber } from '../services/gemini';
import { getHistory, saveHistoryItem, saveHistoryList, clearHistory } from '../utils/storage';

interface Props {
  winningNumbersList: WinningNumbers[]; // Changed from single object to array
}

const CheckSection: React.FC<Props> = ({ winningNumbersList }) => {
  const [inputNum, setInputNum] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkPeriods = winningNumbersList.slice(0, 2);

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const performCheck = (num: string): CheckResult => {
    // If no data, return empty result
    if (checkPeriods.length === 0) {
        return { isMatch: false, prizeType: PrizeType.None, amount: 0 };
    }

    let bestResult: CheckResult | null = null;

    // Iterate through all periods (Current and Previous)
    for (let i = 0; i < checkPeriods.length; i++) {
        const winning = checkPeriods[i];
        const isCurrent = i === 0;
        const res = checkInvoice(num, winning, isCurrent);

        if (res.isMatch) {
            // Prioritize:
            // 1. Real money win over partial warning (Special/Grand suffix match)
            // 2. Higher amount over lower amount
            // 3. Current period over previous period (if amounts equal)
            
            if (!bestResult) {
                bestResult = res;
            } else {
                const bestIsPartial = bestResult.isPartial || false;
                const currentIsPartial = res.isPartial || false;

                if (bestIsPartial && !currentIsPartial) {
                     bestResult = res; // Found a real win, replace partial
                } else if (!bestIsPartial && !currentIsPartial) {
                     // Both real wins, check amount
                     if ((res.amount || 0) > (bestResult.amount || 0)) {
                         bestResult = res;
                     }
                }
                // If both partial, stick to first found (Current) usually
            }
        }
    }

    // If matches found, return best match. 
    if (bestResult) return bestResult;

    // If no match found in ANY period, just return a fail result for the current period (for display purposes)
    return checkInvoice(num, checkPeriods[0], true);
  };

  // Re-check when winningNumbersList loads/changes
  useEffect(() => {
    if (inputNum && inputNum.length >= 3 && checkPeriods.length > 0) {
      const res = performCheck(inputNum);
      setResult(res);
    }
  }, [winningNumbersList]);

  // Auto-save history when input changes (Debounced)
  useEffect(() => {
    if (!inputNum || inputNum.length < 3 || checkPeriods.length === 0) return;

    const timer = setTimeout(() => {
       const res = performCheck(inputNum);
       
       setHistory(prevHistory => {
         const lastItem = prevHistory[0];
         let newHistory;

         // Smart Update
         if (lastItem && inputNum.startsWith(lastItem.number) && inputNum.length > lastItem.number.length) {
            const updatedItem = {
                ...lastItem,
                number: inputNum,
                result: res,
                timestamp: Date.now()
            };
            newHistory = [updatedItem, ...prevHistory.slice(1)];
         } 
         else if (lastItem && lastItem.number === inputNum) {
            return prevHistory;
         }
         else {
            const newItem: HistoryItem = {
                id: Date.now().toString(),
                number: inputNum,
                timestamp: Date.now(),
                result: res
            };
            newHistory = [newItem, ...prevHistory].slice(0, 50);
         }
         
         saveHistoryList(newHistory);
         return newHistory;
       });

    }, 500); 

    return () => clearTimeout(timer);
  }, [inputNum, winningNumbersList]);

  const addToHistory = (num: string, res: CheckResult) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      number: num,
      timestamp: Date.now(),
      result: res
    };
    const updatedHistory = saveHistoryItem(newItem);
    setHistory(updatedHistory);
  };

  const handleManualCheck = (num: string) => {
    setInputNum(num);
    if (checkPeriods.length === 0) return;
    
    if (num.length >= 3) {
      const res = performCheck(num);
      setResult(res);
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
    setInputNum('');

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        const base64Data = base64String.split(',')[1];
        
        const extractedNumber = await extractInvoiceNumber(base64Data, file.type);
        
        if (extractedNumber) {
          setInputNum(extractedNumber);
          const res = performCheck(extractedNumber);
          setResult(res);
          addToHistory(extractedNumber, res);
        } else {
          setResult({ isMatch: false, prizeType: PrizeType.None, description: "無法辨識號碼，請手動輸入" });
        }
        setIsScanning(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsScanning(false);
      alert("掃描失敗，請重試");
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
        快速對獎 (自動比對近兩期)
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
                onClick={() => { setInputNum(''); setResult(null); }}
                className="text-gray-400 hover:text-gray-600 p-2"
                aria-label="Clear input"
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
                辨識中...
              </span>
            ) : (
              <span className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                相機掃描
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Result Display */}
      {result ? (
        <div className={`rounded-xl p-6 text-center transition-all duration-300 transform ${result.isMatch ? 'scale-100' : 'scale-100'} ${getResultColor(result)}`}>
          {result.isMatch ? (
            <div>
               {/* Period Badge */}
               {result.period && (
                   <div className="inline-block mb-3 px-3 py-1 rounded-full bg-black/20 text-white/90 text-sm font-bold backdrop-blur-sm">
                       {result.period} {result.isCurrentPeriod ? '(當期)' : '(前一期)'}
                   </div>
               )}
              
              <div className="text-3xl font-bold mb-2">
                  {result.isPartial ? '⚠️ 注意！疑似中獎' : '🎉 恭喜中獎！'}
              </div>
              <div className="text-xl opacity-90">{result.prizeType}</div>
              {result.description && <div className="text-sm mt-2 opacity-90 font-medium">({result.description})</div>}
              {result.matchedNumber && <div className="mt-4 font-mono font-bold bg-white/20 inline-block px-4 py-1 rounded">號碼：{result.matchedNumber}</div>}
            </div>
          ) : (
            <div>
              <div className="text-lg font-bold">😔 沒中獎</div>
              <div className="text-sm mt-1">{result.description || "再接再厲，下一張會更好！"}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center text-gray-400 py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          輸入號碼 (至少3碼) 將自動比對當期與前一期
        </div>
      )}

      {/* History List */}
      {history.length > 0 && (
        <div className="mt-8 border-t border-gray-100 pt-6">
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-bold text-gray-700 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-gray-500"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              歷史紀錄
            </h4>
            <button 
              onClick={() => { clearHistory(); setHistory([]); }} 
              className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center"
            >
              清除全部
            </button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {history.map(item => (
              <div key={item.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg text-sm border border-transparent hover:border-gray-200 transition-colors">
                  <div className="flex flex-col">
                       <span className="font-mono font-medium text-gray-800 text-lg tracking-wider">{item.number}</span>
                       <div className="flex items-center gap-2 mt-0.5">
                           <span className="text-xs text-gray-400">{formatTime(item.timestamp)}</span>
                           {item.result.period && item.result.isMatch && (
                               <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                                   {item.result.isCurrentPeriod ? '當期' : '前期'}
                               </span>
                           )}
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
