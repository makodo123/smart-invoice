import React, { useState, useEffect } from 'react';
import { WinningNumbers, CheckResult, PrizeType, HistoryItem } from '../types';
import { checkInvoice, pickBestResult, resultLabel } from '../utils/checkLogic';
import { addHistoryItems } from '../utils/storage';
import { initTokenClient, requestAccessToken, revokeAccessToken, fetchInvoiceEmails, fetchMessageDetails, GmailMessage, GmailAuthError } from '../services/gmail';
import { findCandidatePeriodIndexes, findPeriodIndexForDate, getComparePeriods, parseInvoiceDate, parsePeriod } from '../utils/period';

interface Props {
  winningNumbersList: WinningNumbers[];
  selectedIndex: number;
}

const CONFIGURED_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || '';
const MAX_SCAN_MESSAGES = 200;
const SCAN_CONCURRENCY = 5;

const GmailCheckSection: React.FC<Props> = ({ winningNumbersList, selectedIndex }) => {
  const [clientId, setClientId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scannedCount, setScannedCount] = useState(0);
  const [results, setResults] = useState<{msg: GmailMessage, check: CheckResult}[]>([]);
  const [scannedLog, setScannedLog] = useState<{msg: GmailMessage, check: CheckResult}[]>([]);
  const [queryOverride, setQueryOverride] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  
  // UI States
  const [needsConfig, setNeedsConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  // A public OAuth client ID may be configured in .env.local. A manual value
  // remains available for local experimentation without committing credentials.
  useEffect(() => {
    const savedId = localStorage.getItem('google_client_id');
    const finalId = CONFIGURED_CLIENT_ID || savedId || '';
    
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
      // 一般使用者不需要看到 Client ID 設定；開發者可展開「開發者設定」
      setNotConfigured(true);
    }
  }, []);

  const handleLoginClick = () => {
    if (!clientId) {
      setNotConfigured(true);
      return;
    }
    setNotice(null);

    // Save for future
    if (clientId !== CONFIGURED_CLIENT_ID) {
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
      setNotice("Google 登入初始化失敗，請確認 Client ID 格式正確，或參考設定教學。");
      console.error(e);
      setNeedsConfig(true);
      setShowHelp(true);
    }
  };

  const handleDisconnect = async () => {
    try {
      await revokeAccessToken();
      setIsLoggedIn(false);
      setScanProgress('已中斷 Gmail 授權；本機掃描結果仍會保留，直到你清除瀏覽器資料。');
    } catch (error) {
      console.error('Failed to revoke Gmail access', error);
      setNotice('無法中斷 Google 授權，請稍後再試。');
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
        const range = parsePeriod(item.period);
        if (!range) return;
        if (!minDate || range.start < minDate) minDate = range.start;
        if (!maxDate || range.end > maxDate) maxDate = range.end;
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

  /**
   * 判斷一封信的發票要比對哪一期：
   * 1. 信件或附件中有「發票日期」→ 用發票日期決定期別
   * 2. 只有收信日期 → 交界處（次月前 3 天）前後兩期都比對
   * 3. 都對不到 → 標示「期別不明」，不當作未中獎
   */
  const checkInvoiceForMessage = (parsedNumber: string, invoiceDate: string | undefined, emailTs: number, periods: WinningNumbers[]): CheckResult => {
    const date = parseInvoiceDate(invoiceDate);
    if (date) {
      const index = findPeriodIndexForDate(date, winningNumbersList);
      if (index >= 0) return checkInvoice(parsedNumber, winningNumbersList[index], index === 0);
      return { isMatch: false, prizeType: PrizeType.None, amount: 0, periodUnknown: true, description: `發票日期 ${invoiceDate} 不在已開獎期別內` };
    }

    const candidates = findCandidatePeriodIndexes(emailTs, periods).map(index => periods[index]);
    if (candidates.length === 0) {
      return { isMatch: false, prizeType: PrizeType.None, amount: 0, periodUnknown: true, description: '無法判斷發票期別' };
    }
    const best = pickBestResult(candidates.map(winning => checkInvoice(parsedNumber, winning, winningNumbersList.indexOf(winning) === 0)))!;
    if (candidates.length > 1) {
      return { ...best, description: `收信日在期別交界，已比對 ${candidates.map(item => item.period).join('、')}，請核對發票日期` };
    }
    return best;
  };

  const scanPeriods = getComparePeriods(winningNumbersList, selectedIndex);

  const startScanning = async () => {
    if (scanPeriods.length === 0) {
      setNotice("請先等待中獎號碼載入。");
      return;
    }
    setNotice(null);

    setIsScanning(true);
    setResults([]);
    setScannedLog([]);
    setScannedCount(0);

    const range = getSearchRange(scanPeriods);
    let rangeLabel = "自動偵測日期";
    let defaultQuery = '{發票 invoice}';

    if (range) {
        // Search terms are intentionally broader than a user-created label.
        defaultQuery += ` after:${range.apiQueryAfter} before:${range.apiQueryBefore}`;
        rangeLabel = range.label;
    }
    const labelQuery = labelFilter.trim()
      ? `label:"${labelFilter.trim().replace(/"/g, '')}"`
      : '';
    const query = [queryOverride.trim() || defaultQuery, labelQuery].filter(Boolean).join(' ');

    setScanProgress(`正在搜尋「${rangeLabel}」的發票（最多 ${MAX_SCAN_MESSAGES} 封）...`);

    try {
      const messages = await fetchInvoiceEmails(query, MAX_SCAN_MESSAGES);
      
      if (messages.length === 0) {
        setScanProgress(`在區間 ${rangeLabel} 找不到符合搜尋條件的郵件，請檢查標籤或自訂條件。`);
        setIsScanning(false);
        return;
      }

      setScanProgress(`找到 ${messages.length} 封相關郵件，開始過濾與解析...`);
      
      let processed = 0;
      let validDateCount = 0;
      let invoiceCount = 0;
      let attachmentErrors = 0;
      let protectedCount = 0;
      const newHistoryItems: HistoryItem[] = [];
      const matchingResults: {msg: GmailMessage, check: CheckResult}[] = [];
      const scanLog: {msg: GmailMessage, check: CheckResult}[] = [];
      const seenInvoiceNumbers = new Set<string>();

      for (let index = 0; index < messages.length; index += SCAN_CONCURRENCY) {
        const batch = messages.slice(index, index + SCAN_CONCURRENCY);
        const detailsList = await Promise.allSettled(batch.map(message => fetchMessageDetails(message.id)));

        for (const detailResult of detailsList) {
          processed++;
          if (detailResult.status === 'rejected') {
            if (detailResult.reason instanceof GmailAuthError) throw detailResult.reason;
            attachmentErrors++;
            console.warn('Unable to scan a Gmail message', detailResult.reason);
            continue;
          }
          const details = detailResult.value;

          // Gmail's date filter has small boundary variations, so enforce the
          // selected invoice period once more before displaying any message.
          const emailTs = parseInt(details.internalDate, 10);
          if (range && (emailTs < range.minTimestamp || emailTs > range.maxTimestamp)) continue;

          validDateCount++;
          attachmentErrors += details.attachmentErrors || 0;
          protectedCount += details.protectedAttachments || 0;
          const invoices = details.invoices || [];
          if (invoices.length === 0) {
            scanLog.push({ msg: { ...details, fullNumber: '未解析' }, check: { isMatch: false, prizeType: PrizeType.None, amount: 0 } });
          }

          for (const invoice of invoices) {
            invoiceCount++;
            // 同一張發票可能出現在多封信（通知信、開立信），只列一次
            if (seenInvoiceNumbers.has(invoice.fullNumber)) continue;
            seenInvoiceNumbers.add(invoice.fullNumber);

            const invoiceMsg = { ...details, ...invoice };
            const bestResult = checkInvoiceForMessage(invoice.parsedNumber, details.invoiceDate, emailTs, scanPeriods);

            if (bestResult.isMatch) {
              matchingResults.push({ msg: invoiceMsg, check: bestResult });
              newHistoryItems.push({
                id: `${Date.now()}-${Math.random()}`,
                number: invoice.parsedNumber,
                timestamp: emailTs,
                result: bestResult,
                source: 'gmail',
                invoiceDate: details.invoiceDate,
              });
            }
            scanLog.push({ msg: invoiceMsg, check: bestResult });
          }
        }

        setResults([...matchingResults]);
        setScannedLog([...scanLog]);
        setScannedCount(validDateCount);
        setScanProgress(`正在處理 (${processed}/${messages.length})，找到 ${invoiceCount} 張發票...`);
      }

      // 寫入前重新讀取歷史紀錄，不會覆蓋掃描期間手動對獎的紀錄
      addHistoryItems(newHistoryItems);

      setScanProgress(`掃描完成！${validDateCount} 封符合日期，解析出 ${invoiceCount} 張發票，發現 ${matchingResults.length} 張號碼符合獎號。${attachmentErrors ? ` 有 ${attachmentErrors} 封郵件或附件讀取失敗。` : ''}${protectedCount ? ` 略過 ${protectedCount} 個有密碼的 PDF（通常是帳單，不是發票）。` : ''}${messages.length === MAX_SCAN_MESSAGES ? ' 已達掃描上限，可能還有未掃描郵件。' : ''}`);

    } catch (e: any) {
      console.error(e);
      if (e instanceof GmailAuthError) {
        setIsLoggedIn(false);
        setScanProgress('');
        setNotice('Gmail 授權已過期（約 1 小時），請按「連結 Gmail」重新授權後再掃描。');
      } else {
        setScanProgress(`發生錯誤：${e.message}`);
      }
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
        
        <button
            onClick={() => { const next = !needsConfig; setNeedsConfig(next); setShowHelp(next); }}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${needsConfig ? 'bg-gray-100 text-gray-700 border-gray-300' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
            aria-expanded={needsConfig}
            title="開發者設定（Google OAuth Client ID）"
        >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>開發者設定</span>
        </button>
      </div>

      {notConfigured && !needsConfig && (
        <p className="mb-4 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          此網站尚未啟用 Gmail 登入（站長需設定 Google OAuth Client ID）。你仍可使用上方的手動輸入或 QR Code 對獎。
        </p>
      )}

      {notice && (
        <div className="mb-4 p-3 rounded-lg border text-sm flex items-start justify-between gap-3 bg-amber-50 text-amber-800 border-amber-200" role="alert">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="關閉提示">✕</button>
        </div>
      )}

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
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(currentOrigin);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            } catch {
                                setNotice('無法自動複製，請手動選取網址。');
                            }
                        }}
                        className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-md font-medium transition-colors"
                     >
                        {copied ? '已複製' : '複製'}
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
           <p className="text-xs text-orange-700 mb-2">請輸入 Web Application 類型的 Client ID。正式版請在 <code>.env.production</code>、本機開發請在 <code>.env.local</code> 設定 <code>VITE_GOOGLE_CLIENT_ID</code>。</p>
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
                     setShowHelp(false);
                     localStorage.setItem('google_client_id', clientId);
                     if (clientId.trim()) setNotConfigured(false);
                 }}
                 className="text-xs bg-orange-200 hover:bg-orange-300 text-orange-800 px-4 py-1.5 rounded-lg font-medium transition-colors"
               >
                 儲存設定
               </button>
           </div>
        </div>
      )}

      {!notConfigured && (
      <>
      <details className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <summary className="text-xs font-bold text-gray-600 cursor-pointer select-none">進階搜尋設定（標籤、自訂搜尋條件）</summary>
        <label htmlFor="gmail-label" className="block text-xs font-bold text-gray-700 mb-1">Gmail 標籤（可選）</label>
        <input
          id="gmail-label"
          type="text"
          value={labelFilter}
          onChange={(event) => setLabelFilter(event.target.value)}
          placeholder="例如：電子發票"
          className="w-full bg-white p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">填入後只掃描具有此標籤的信件；可與下方搜尋條件同時使用。</p>

        <label htmlFor="gmail-query" className="block text-xs font-bold text-gray-700 mt-3 mb-1">Gmail 搜尋條件（可選）</label>
        <input
          id="gmail-query"
          type="text"
          value={queryOverride}
          onChange={(event) => setQueryOverride(event.target.value)}
          placeholder="預設：依期別搜尋含「發票／invoice」的郵件"
          className="w-full bg-white p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none"
        />
      </details>
      <p className="-mt-2 mb-3 text-xs text-gray-500">只在你按下掃描後讀取最多 {MAX_SCAN_MESSAGES} 封符合條件的信件；內容只在你的瀏覽器中處理，不會傳送到其他伺服器。</p>

      {!isLoggedIn ? (
         <button
            onClick={handleLoginClick}
            aria-label="連結 Gmail 並自動兌獎"
            className="w-full bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center transition-all shadow-sm hover:shadow-md active:scale-[0.99]"
         >
            <svg aria-hidden="true" className="w-5 h-5 mr-3" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            連結 Gmail 並自動兌獎
         </button>
      ) : (
         <div>
            <div className="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500">
              <span>已授權唯讀存取 Gmail，權杖只保留在本次瀏覽器工作階段。</span>
              <button onClick={handleDisconnect} className="shrink-0 text-red-600 hover:text-red-700 underline">中斷連線</button>
            </div>
            {!isScanning && (
               <button
                  onClick={startScanning}
                  className="w-full bg-red-600 text-white hover:bg-red-700 font-bold py-3.5 px-4 rounded-xl transition-all shadow-md active:scale-[0.99] flex items-center justify-center"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16l5 5"/><path d="M21 21v-5h-5"/></svg>
                  掃描 Gmail 發票
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
                    搜尋 {rangeInfo.label} 收到的信件；信中有發票日期時依發票日期對獎，否則依收信日期判斷期別
                </div>
            )}
            {!isScanning && scanProgress && (
                <p className="mt-2 text-center text-xs text-gray-500" role="status">{scanProgress}</p>
            )}
         </div>
      )}

      </>
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
                        {item.check.period && <div className="text-xs text-gray-500 mt-1">對獎期別：{item.check.period}{item.msg.invoiceDate ? `（發票日期 ${item.msg.invoiceDate}）` : ''}</div>}
                        {(item.check.isPartial || item.check.description?.includes('交界')) && <div className="text-xs text-orange-600 mt-1">{item.check.description}</div>}
                    </div>
                    <div className="text-right flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-0 pt-2 sm:pt-0 border-orange-200">
                        <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-lg font-bold shadow-sm mb-0 sm:mb-1">
                            {item.check.isPartial ? '疑似中獎，請核對' : item.check.prizeType}
                        </span>
                        {!item.check.isPartial && (
                          <div className="text-sm text-red-600 font-extrabold ml-auto sm:ml-0">
                             ${item.check.amount?.toLocaleString()}
                          </div>
                        )}
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
                本次掃描明細 (收信日期：{rangeInfo?.label})
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
                                            <span className="text-red-600 font-bold text-xs bg-red-100 px-2 py-1 rounded-full">{resultLabel(item.check)}</span>
                                        ) : (
                                            <span className="text-gray-400 text-xs" title={item.check.description}>{item.msg.parsedNumber ? resultLabel(item.check) : item.msg.attachmentErrors ? '附件讀取失敗' : item.msg.protectedAttachments ? '附件有密碼（非發票）' : '未解析'}</span>
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
