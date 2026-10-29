import React, { useState, useRef, useEffect } from 'react';
import { WinningNumbers, CheckResult, PrizeType, HistoryItem, InvoiceData } from '../types';
import { checkAgainstPeriods, pickBestResult, resultLabel } from '../utils/checkLogic';
import { analyzeInvoice, hasGeminiApiKey, hasBuiltInGeminiApiKey, getGeminiApiKey, setUserGeminiApiKey } from '../services/gemini';
import { compressImage } from '../utils/imageUtils';
import { exportToCSV } from '../utils/export';
import {
  getHistory, saveHistoryItem, upsertTypedHistoryItem, clearHistory, saveInvoiceData, getInvoiceData,
  clearInvoiceData, saveHistoryList, updateInvoiceResults, removeHistoryItem, STORAGE_CHANGE_EVENT,
} from '../utils/storage';
import { estimateNetPrize, OFFICIAL_CLAIM_INFO_URL } from '../utils/prize';
import { recheckHistory } from '../utils/historyRecheck';
import { decodeQRFromImage, parseTaiwanInvoiceQR } from '../utils/qrScanner';
import { formatShortDate, getClaimWindow, getComparePeriods, isClaimExpired } from '../utils/period';
import { QrScannerModal } from './QrScannerModal';

interface Props {
  winningNumbersList: WinningNumbers[];
  selectedIndex: number;
}

type Notice = { tone: 'info' | 'warn' | 'error'; text: string };

const NOTICE_STYLES: Record<Notice['tone'], string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
};

const GEMINI_KEY_HELP_URL = 'https://aistudio.google.com/apikey';

const isBigPrize = (res: CheckResult) =>
  !res.isPartial && [PrizeType.Special, PrizeType.Grand, PrizeType.First].includes(res.prizeType);

const formatHistoryTime = (timestamp: number) =>
  new Date(timestamp).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const CheckSection: React.FC<Props> = ({ winningNumbersList, selectedIndex }) => {
  const [inputNum, setInputNum] = useState('');
  const [results, setResults] = useState<CheckResult[]>([]);
  const [scannedData, setScannedData] = useState<InvoiceData | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => getHistory());
  const [invoiceList, setInvoiceList] = useState<InvoiceData[]>(() => getInvoiceData());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [winsOnly, setWinsOnly] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(() => hasGeminiApiKey());
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState(() => (hasBuiltInGeminiApiKey() ? '' : getGeminiApiKey()));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const comparePeriods = getComparePeriods(winningNumbersList, selectedIndex);
  const isReady = winningNumbersList.length > 0;
  const result = pickBestResult(results);
  const otherResults = results.filter(item => item !== result);
  const visibleHistory = winsOnly ? history.filter(item => item.result.isMatch) : history;

  // 歷史紀錄可能被 Gmail 區塊或其他分頁改動，統一從 localStorage 重新讀取
  useEffect(() => {
    const reload = () => {
      setHistory(getHistory());
      setInvoiceList(getInvoiceData());
    };
    window.addEventListener(STORAGE_CHANGE_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(STORAGE_CHANGE_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  // 新一期開獎（獎號更新）後，替歷史紀錄中當時尚未開獎的發票重新對獎
  useEffect(() => {
    if (!isReady) return;
    const { history: updated, changed, dirty } = recheckHistory(getHistory(), winningNumbersList);
    if (!dirty) return;
    saveHistoryList(updated);
    setHistory(updated);
    updateInvoiceResults(changed.filter(item => item.invoiceDate).map(item => ({
      invoiceNumber: item.number,
      date: item.invoiceDate!,
      period: item.result.period,
      prize: resultLabel(item.result),
      prizeAmount: item.result.isMatch && !item.result.isPartial ? item.result.amount : 0,
    })));
    if (changed.length > 0) {
      const winners = changed.filter(item => item.result.isMatch);
      setNotice({
        tone: winners.length > 0 ? 'warn' : 'info',
        text: `新一期獎號已公布，已為 ${changed.length} 筆歷史紀錄重新對獎` +
          (winners.length > 0
            ? `，其中 ${winners.length} 張中獎或疑似中獎：${winners.slice(0, 3).map(item => `${item.number}（${resultLabel(item.result)}）`).join('、')}${winners.length > 3 ? ' 等' : ''}。`
            : '，皆未中獎。'),
      });
    }
  }, [winningNumbersList]);

  // 獎號更新或切換期別時重新對獎
  useEffect(() => {
    if (inputNum.length >= 3 && isReady) {
      setResults(checkAgainstPeriods(inputNum, winningNumbersList, selectedIndex, scannedData?.date));
    }
  }, [winningNumbersList, selectedIndex]);

  // 手動輸入停頓後自動存入歷史紀錄（掃描結果在掃描時就已存檔）
  useEffect(() => {
    if (scannedData || inputNum.length < 3 || !isReady) return;

    const timer = setTimeout(() => {
      const checks = checkAgainstPeriods(inputNum, winningNumbersList, selectedIndex);
      const best = pickBestResult(checks);
      if (!best) return;
      setHistory(upsertTypedHistoryItem({
        id: `${Date.now()}`, number: inputNum, timestamp: Date.now(), result: best,
        source: 'manual', checkedPeriods: checks.flatMap(item => (item.period ? [item.period] : [])),
      }));
    }, 1000);

    return () => clearTimeout(timer);
  }, [inputNum, winningNumbersList, selectedIndex, scannedData]);

  const handleManualCheck = (num: string) => {
    setInputNum(num);
    setScannedData(null); // Clear scanned details on manual input
    setNotice(null);
    if (num.length >= 3 && isReady) {
      setResults(checkAgainstPeriods(num, winningNumbersList, selectedIndex));
    } else {
      setResults([]);
    }
  };

  // 按 Enter 後全選號碼，下一張直接輸入即可取代
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    inputRef.current?.select();
  };

  const clearInput = () => {
    setInputNum('');
    setResults([]);
    setScannedData(null);
    setNotice(null);
    inputRef.current?.focus();
  };

  /** 掃描成功：依發票日期對獎並存檔，回傳結果給連續掃描清單 */
  const handleScanSuccess = (data: InvoiceData): CheckResult | null => {
    const checks = checkAgainstPeriods(data.invoiceNumber, winningNumbersList, selectedIndex, data.date);
    const best = pickBestResult(checks);
    setInputNum(data.invoiceNumber);
    setScannedData(data);
    setResults(checks);
    setNotice(null);
    if (!best) return null;

    setHistory(saveHistoryItem({
      id: `${Date.now()}-${data.invoiceNumber}`, number: data.invoiceNumber, timestamp: Date.now(), result: best,
      source: 'scan', invoiceDate: data.date || undefined,
      checkedPeriods: checks.flatMap(item => (item.period ? [item.period] : [])),
    }));
    setInvoiceList(saveInvoiceData({
      ...data,
      period: best.period,
      prize: resultLabel(best),
      prizeAmount: best.isMatch && !best.isPartial ? best.amount : 0,
    }));
    return best;
  };

  /** AI 圖片辨識；回傳 null 時 message 說明原因 */
  const recognizeWithAi = async (file: File): Promise<{ result: CheckResult | null; message?: string }> => {
    if (!hasApiKey) return { result: null, message: '未設定 Gemini API 金鑰，無法使用 AI 圖片辨識。' };
    try {
      const base64Data = await compressImage(file, 1024, 0.8);
      const data = await analyzeInvoice(base64Data, file.type);
      if (data?.invoiceNumber) return { result: handleScanSuccess(data) };
      return { result: null, message: 'AI 圖片辨識未找到發票號碼，請手動輸入。' };
    } catch (err) {
      console.error(err);
      return { result: null, message: 'AI 辨識失敗，請重試或手動輸入。' };
    }
  };

  const handleFallbackToAi = async (file: File) => {
    setIsScanning(true);
    const { message } = await recognizeWithAi(file);
    if (message) setNotice({ tone: 'warn', text: message });
    setIsScanning(false);
    return message ?? null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isReady) {
      setNotice({ tone: 'info', text: '請先等待中獎號碼載入。' });
      return;
    }

    setIsScanning(true);
    setResults([]);
    setScannedData(null);
    setInputNum('');
    setNotice(null);

    try {
      // 1. 優先辨識電子發票 QR Code
      const qrText = await decodeQRFromImage(file);
      if (qrText) {
        const parsed = parseTaiwanInvoiceQR(qrText);
        if (parsed?.data && parsed.data.invoiceNumber) {
          handleScanSuccess(parsed.data);
          return;
        } else if (parsed?.isRightSide) {
          setNotice({ tone: 'warn', text: '偵測到電子發票右側明細條碼，請拍攝「左側」主要 QR Code 進行對獎。' });
          return;
        }
      }

      // 2. 若無 QR Code：沒有金鑰就提示手動輸入
      if (!hasApiKey) {
        setNotice({ tone: 'warn', text: '未在圖片中偵測到電子發票 QR Code。請對準發票左側 QR Code 重拍，或直接輸入號碼。' });
        return;
      }

      // 3. 有 Gemini API Key 時進行 AI 備援辨識
      const { message } = await recognizeWithAi(file);
      if (message) setNotice({ tone: 'warn', text: message });
    } catch (err) {
      console.error(err);
      setNotice({ tone: 'error', text: '掃描失敗，請重試。' });
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearHistory();
    clearInvoiceData();
    setHistory([]);
    setInvoiceList([]);
    setConfirmClear(false);
  };

  // 「確定清除？」幾秒內沒按就恢復
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  const saveAiKey = () => {
    setUserGeminiApiKey(aiKeyInput);
    setHasApiKey(hasGeminiApiKey());
    setShowAiSettings(false);
  };

  const getResultColor = (res: CheckResult) => {
    if (res.isPartial) return 'bg-orange-100 text-orange-800 border-2 border-orange-300';
    if (res.periodUnknown) return 'bg-slate-100 text-slate-700 border border-slate-200';
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

  const resultHeadline = (res: CheckResult) => {
    if (res.isPartial) return '⚠️ 疑似中獎';
    if (res.mayBeHigher) return `🎉 至少中${res.prizeType.split(' ')[0]}！`;
    return '🎉 恭喜中獎！';
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
      <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center">
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-indigo-600"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        快速對獎
      </h3>
      {comparePeriods.length > 0 && (
        <p className="text-xs text-gray-500 mb-4">
          輸入號碼會{comparePeriods.length > 1 ? '同時' : ''}比對 {comparePeriods.map(item => item.period).join(' 和 ')}（可在下方獎號表切換）；掃描發票會自動選對期別。
        </p>
      )}

      {/* Input Area */}
      <div className="flex flex-col md:flex-row gap-3 mb-3">
        <form onSubmit={handleManualSubmit} className="relative flex-grow">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label="發票號碼"
            value={inputNum}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 8);
              handleManualCheck(val);
            }}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="輸入末 3 碼或完整 8 碼"
            className="w-full text-center text-3xl font-mono tracking-widest py-4 rounded-xl border-2 border-indigo-100 focus:border-indigo-500 focus:ring focus:ring-indigo-200 transition-all outline-none text-gray-700 placeholder:text-xl placeholder:text-gray-300"
            disabled={!isReady || isScanning}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center space-x-2">
            {inputNum && (
              <button
                type="button"
                onClick={clearInput}
                className="text-gray-400 hover:text-gray-600 p-2"
                title="清除輸入"
                aria-label="清除輸入"
              >
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
          </div>
        </form>

        <div className="flex gap-2">
          {/* Main QR Scanner Button */}
          <button
            onClick={() => setIsScannerOpen(true)}
            disabled={!isReady || isScanning}
            className={`flex-1 md:flex-none min-w-0 flex items-center justify-center px-4 md:px-6 py-4 rounded-xl font-bold transition-all shadow-sm ${
              isScanning
                ? 'bg-gray-100 text-gray-400 cursor-wait'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
            }`}
            title="掃描電子發票 QR Code"
          >
            <span className="flex items-center whitespace-nowrap">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
              {isScanning ? '辨識中...' : '掃描 QR Code'}
            </span>
          </button>

          {/* Upload Photo Button */}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isReady || isScanning}
            className="shrink-0 flex items-center justify-center gap-1.5 px-3 md:px-4 py-4 rounded-xl font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 transition-all border border-gray-200 whitespace-nowrap"
            title="選擇或拍攝發票照片"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span className="text-sm">上傳照片</span>
          </button>
        </div>
      </div>

      {/* AI 圖片辨識設定（正式版不內建金鑰時，使用者可填自己的金鑰） */}
      {!hasBuiltInGeminiApiKey() && (
        <div className="mb-4 text-xs text-gray-500">
          <button type="button" onClick={() => setShowAiSettings(!showAiSettings)} className="underline hover:text-gray-700">
            {hasApiKey ? 'AI 圖片辨識：已啟用（修改金鑰）' : '（進階）紙本發票沒有 QR Code？可啟用 AI 圖片辨識'}
          </button>
          {showAiSettings && (
            <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <label htmlFor="gemini-key" className="block font-bold text-gray-700 mb-1">Gemini API 金鑰</label>
              <div className="flex gap-2">
                <input
                  id="gemini-key"
                  type="password"
                  autoComplete="off"
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder="AIza..."
                  className="flex-grow p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-indigo-400"
                />
                <button type="button" onClick={saveAiKey} className="px-3 py-2 bg-indigo-600 text-white rounded-lg font-medium">
                  儲存
                </button>
              </div>
              <p className="mt-1">
                需要一組免費的 Google Gemini API 金鑰，可到 <a href={GEMINI_KEY_HELP_URL} target="_blank" rel="noreferrer" className="underline text-indigo-600">Google AI Studio</a> 申請。
                金鑰只存在這個瀏覽器，辨識時照片會直接傳給 Google。清空後儲存即可移除。
              </p>
            </div>
          )}
        </div>
      )}

      {notice && (
        <div className={`mb-4 p-3 rounded-lg border text-sm flex items-start justify-between gap-3 ${NOTICE_STYLES[notice.tone]}`} role="alert">
          <span className="whitespace-pre-line">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="關閉提示">✕</button>
        </div>
      )}

      {/* Result Display */}
      <div aria-live="polite">
        {result && (
          <div className={`rounded-xl p-6 text-center transition-all duration-300 transform ${getResultColor(result)}`}>
            {result.isMatch ? (
              <div>
                {result.period && (
                  <div className={`inline-block mb-3 px-3 py-1 rounded-full text-sm font-bold ${isBigPrize(result) ? 'bg-black/20 text-white' : 'bg-black/10'}`}>
                    {result.period} {result.isCurrentPeriod ? '(最新一期)' : ''}
                  </div>
                )}
                <div className={`${result.isPartial ? 'text-2xl' : 'text-3xl'} font-bold mb-2`}>{resultHeadline(result)}</div>
                <div className={result.isPartial ? 'text-base opacity-80' : 'text-xl opacity-90'}>
                  {result.isPartial ? `對照：${result.prizeType}` : result.prizeType}
                </div>
                {(result.isPartial || result.mayBeHigher) && result.description && (
                  <div className="mt-2 text-sm font-medium">{result.description}</div>
                )}
                {result.matchedNumber && <div className="mt-4 font-mono font-bold bg-white/20 inline-block px-4 py-1 rounded">對照獎號：{result.matchedNumber}</div>}
                {result.period && isClaimExpired(result.period) ? (
                  <div className="mt-3 text-sm font-bold bg-black/20 rounded px-3 py-1 inline-block">⚠️ 此期已超過領獎期限</div>
                ) : !result.isPartial && <ClaimInfo result={result} />}
              </div>
            ) : result.periodUnknown ? (
              <div>
                <div className="text-lg font-bold">🕒 無法對獎</div>
                <div className="text-sm mt-1">{result.description}</div>
              </div>
            ) : (
              <div>
                <div className="text-lg font-bold">😔 沒中獎</div>
                <div className="text-sm mt-1">
                  {result.description || (results.length > 1 ? `${results.map(item => item.period).join('、')} 皆未中獎` : "再接再厲，下一張會更好！")}
                </div>
              </div>
            )}

            {/* 其他期別的結果 */}
            {result.isMatch && otherResults.length > 0 && (
              <div className="mt-4 pt-3 border-t border-black/10 text-sm space-y-1">
                {otherResults.map(item => (
                  <div key={item.period} className="flex justify-between">
                    <span className="opacity-80">{item.period}</span>
                    <span className="font-medium">{resultLabel(item)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Scanned Details Info */}
            {scannedData && (
              <div className="mt-4 pt-4 border-t border-black/10 text-left bg-white/10 rounded p-3 text-sm">
                {scannedData.fullNumber && (
                  <div className="flex justify-between items-center mb-1">
                    <span className="opacity-70">發票號碼：</span>
                    <span className="font-mono font-medium">{scannedData.fullNumber}</span>
                  </div>
                )}
                <div className="flex justify-between items-center mb-1">
                  <span className="opacity-70">消費日期：</span>
                  <span className="font-medium">{scannedData.date || '無紀錄'}</span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="opacity-70">{scannedData.storeName ? '商家：' : '賣方統編：'}</span>
                  <span className="font-medium">{scannedData.storeName || scannedData.sellerId || '無紀錄'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="opacity-70">消費金額：</span>
                  <span className="font-bold text-lg">{scannedData.amount ? `$${scannedData.amount}` : '無紀錄'}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* History & Export */}
      {history.length > 0 && (
        <div className="mt-8 border-t border-gray-100 pt-6">
          <div className="flex flex-wrap justify-between items-center gap-y-2 mb-4">
            <h4 className="font-bold text-gray-700 flex items-center">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 text-gray-500"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              歷史紀錄
            </h4>
            <label className="ml-3 mr-auto flex items-center gap-1 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={winsOnly} onChange={(e) => setWinsOnly(e.target.checked)} className="accent-indigo-600" />
              只看中獎
            </label>
            <div className="flex gap-3 items-center">
              {invoiceList.length > 0 && (
                <button
                  onClick={() => exportToCSV(invoiceList)}
                  className="text-xs bg-green-50 text-green-600 hover:bg-green-100 px-3 py-1 rounded transition-colors flex items-center"
                  title="匯出掃描過的發票（CSV 檔，可用 Excel 開啟）；手動輸入的號碼不會匯出"
                >
                  <svg aria-hidden="true" className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                  匯出掃描的發票 ({invoiceList.length})
                </button>
              )}
              {confirmClear && (
                <button onClick={() => setConfirmClear(false)} className="text-xs text-gray-500 hover:text-gray-700">取消</button>
              )}
              <button
                onClick={handleClearAll}
                className={`text-xs transition-colors ${confirmClear ? 'text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded font-bold' : 'text-gray-400 hover:text-red-500'}`}
              >
                {confirmClear ? '確定清除所有紀錄與掃描的發票？' : '清除全部'}
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {winsOnly && visibleHistory.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-4">目前沒有中獎紀錄</p>
            )}
            {visibleHistory.map(item => (
              <div key={item.id} className="flex justify-between items-center gap-3 bg-gray-50 p-3 rounded-lg text-sm border border-transparent hover:border-gray-200 transition-colors">
                <div className="flex flex-col min-w-0">
                  <span className="font-mono font-medium text-gray-800 text-lg tracking-wider">{item.number}</span>
                  <div className="flex flex-wrap items-center gap-x-2 mt-0.5 text-xs text-gray-400">
                    <span className="whitespace-nowrap">{formatHistoryTime(item.timestamp)}</span>
                    {item.result.period && <span className="whitespace-nowrap">· {item.result.period}</span>}
                  </div>
                  {item.recheckedAt && (
                    <span className="text-xs text-indigo-500 mt-0.5">新一期開獎後已重新對獎（{formatHistoryTime(item.recheckedAt)}）</span>
                  )}
                </div>
                <div className="shrink-0 whitespace-nowrap flex items-center gap-1">
                  {item.result.isMatch ? (
                    <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${item.result.isPartial ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'}`}>
                      {resultLabel(item.result)}
                    </span>
                  ) : (
                    <span className="bg-gray-200 text-gray-500 px-3 py-1 rounded-full text-xs">{resultLabel(item.result)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setHistory(removeHistoryItem(item.id))}
                    className="text-gray-300 hover:text-red-500 p-1"
                    aria-label={`刪除 ${item.number} 這筆紀錄`}
                    title="刪除這筆紀錄"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live QR Scanner Modal */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
        hasApiKey={hasApiKey}
        onFallbackToAi={handleFallbackToAi}
      />
    </div>
  );
};

/** 中獎後的領獎說明：預估實拿金額、應備文件、領獎期間與官方說明連結 */
const ClaimInfo: React.FC<{ result: CheckResult }> = ({ result }) => {
  const claim = result.period ? getClaimWindow(result.period) : null;
  const prize = estimateNetPrize(result.amount || 0);
  const taxed = !result.mayBeHigher && prize.net < prize.gross;
  return (
    <div className="mt-4 bg-white/90 text-gray-700 rounded-lg p-3 text-left text-sm space-y-1">
      <div className="font-bold text-gray-800">領獎方式</div>
      {taxed && (
        <p>
          預估實拿 <span className="font-bold">{prize.net.toLocaleString()}</span> 元
          （{[prize.incomeTax && `20% 所得稅 ${prize.incomeTax.toLocaleString()} 元`, prize.stampTax && `0.4% 印花稅 ${prize.stampTax.toLocaleString()} 元`].filter(Boolean).join('、')}）
        </p>
      )}
      <p>・紙本發票、電子發票證明聯：帶著中獎發票與身分證件去領獎。</p>
      <p>・存在手機條碼的雲端發票：財政部會通知中獎，也可以設定自動匯款到帳戶。</p>
      {claim && <p>・領獎期間：{formatShortDate(claim.claimStart)} ～ {formatShortDate(claim.claimEnd)}</p>}
      <a href={OFFICIAL_CLAIM_INFO_URL} target="_blank" rel="noreferrer" className="inline-block pt-1 text-indigo-600 underline">
        領獎地點與規定請看財政部說明 ↗
      </a>
    </div>
  );
};

export default CheckSection;
