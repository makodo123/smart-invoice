import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseTaiwanInvoiceQR, decodeQRFromImage } from '../utils/qrScanner';
import { CheckResult, InvoiceData } from '../types';
import { resultLabel } from '../utils/checkLogic';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 回傳對獎結果，連續掃描時顯示在清單中 */
  onScanSuccess: (data: InvoiceData) => CheckResult | null;
  hasApiKey: boolean;
  /** AI 辨識；失敗時回傳錯誤訊息，成功回傳 null */
  onFallbackToAi?: (file: File) => Promise<string | null>;
}

type Hint = { text: string; tone: 'normal' | 'warn' };

const DEFAULT_HINT: Hint = { text: '請對準電子發票「左側」QR Code', tone: 'normal' };
// 每秒最多解碼約 7 次，避免低階手機卡頓發燙
const DECODE_INTERVAL_MS = 140;
// 每隔幾次改用整個畫面解碼，以免 QR Code 不在取景框內就永遠掃不到
const FULL_FRAME_EVERY = 5;
// 連續掃描時，同一張發票在這段時間內不重複處理
const DUPLICATE_COOLDOWN_MS = 3000;

const CONTINUOUS_KEY = 'qr_continuous_mode';

const readContinuousPreference = () => {
  try {
    return localStorage.getItem(CONTINUOUS_KEY) === 'true';
  } catch {
    return false;
  }
};

export const QrScannerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onScanSuccess,
  hasApiKey,
  onFallbackToAi
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastDecodeAt = useRef(0);
  const decodeCount = useRef(0);
  const lastScan = useRef<{ number: string; at: number } | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hint, setHint] = useState<Hint>(DEFAULT_HINT);
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);
  const [continuous, setContinuous] = useState<boolean>(readContinuousPreference);
  const [scannedList, setScannedList] = useState<{ data: InvoiceData; result: CheckResult | null }[]>([]);

  // tick 由 requestAnimationFrame 呼叫，透過 ref 讀到最新的設定與 callback
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const onScanSuccessRef = useRef(onScanSuccess);
  onScanSuccessRef.current = onScanSuccess;
  const scannedListRef = useRef(scannedList);
  scannedListRef.current = scannedList;

  const playBeep = (frequency = 880) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
      osc.onended = () => audioCtx.close();
    } catch {}
  };

  const stopCamera = () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async () => {
    stopCamera();
    setCameraError(null);
    setHint(DEFAULT_HINT);

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        animationFrameId.current = requestAnimationFrame(tick);
      }
    } catch (err: any) {
      console.warn('Camera access failed:', err);
      setCameraError('無法存取相機，請確認已允許瀏覽器相機權限，或使用「從相簿/檔案選擇」上傳發票照片。');
    }
  };

  /** 處理一張成功解析的發票；回傳 true 表示掃描結束（非連續模式） */
  const handleInvoice = (data: InvoiceData): boolean => {
    const key = data.fullNumber || data.invoiceNumber;
    const now = Date.now();

    if (continuousRef.current) {
      if (lastScan.current && lastScan.current.number === key && now - lastScan.current.at < DUPLICATE_COOLDOWN_MS) {
        return false;
      }
      lastScan.current = { number: key, at: now };
      if (scannedListRef.current.some(item => (item.data.fullNumber || item.data.invoiceNumber) === key)) {
        setHint({ text: `${key} 已經掃描過了，請換下一張`, tone: 'warn' });
        return false;
      }
    }

    const result = onScanSuccessRef.current(data);
    if (navigator.vibrate) navigator.vibrate(result?.isMatch ? [80, 60, 80] : 80);
    playBeep(result?.isMatch ? 1320 : 880);

    if (!continuousRef.current) {
      stopCamera();
      onClose();
      return true;
    }

    setScannedList(list => [{ data, result }, ...list]);
    setHint({ text: `${key}：${result ? resultLabel(result) : '已記錄'}，請掃描下一張`, tone: result?.isMatch ? 'warn' : 'normal' });
    return false;
  };

  const tick = (time: number) => {
    animationFrameId.current = null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (time - lastDecodeAt.current >= DECODE_INTERVAL_MS && video.readyState === video.HAVE_ENOUGH_DATA) {
      lastDecodeAt.current = time;
      decodeCount.current += 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (ctx && video.videoWidth > 0) {
        // 只解碼畫面中央（取景框附近）的區域，運算量約為整張畫面的 1/4
        const fullFrame = decodeCount.current % FULL_FRAME_EVERY === 0;
        const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * 0.75);
        const sx = fullFrame ? 0 : Math.round((video.videoWidth - side) / 2);
        const sy = fullFrame ? 0 : Math.round((video.videoHeight - side) / 2);
        const sw = fullFrame ? video.videoWidth : side;
        const sh = fullFrame ? video.videoHeight : side;
        canvas.width = sw;
        canvas.height = sh;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

        const imageData = ctx.getImageData(0, 0, sw, sh);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data) {
          const parsed = parseTaiwanInvoiceQR(code.data);
          if (parsed?.isRightSide) {
            setHint({ text: '⚠️ 偵測到右側商品明細，請對準「左側」QR Code', tone: 'warn' });
          } else if (parsed?.data && parsed.data.invoiceNumber) {
            if (handleInvoice(parsed.data)) return;
          }
        }
      }
    }

    animationFrameId.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (isOpen) {
      setScannedList([]);
      lastScan.current = null;
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const toggleContinuous = () => {
    const next = !continuous;
    setContinuous(next);
    try {
      localStorage.setItem(CONTINUOUS_KEY, String(next));
    } catch {}
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setHint({ text: '正在分析發票 QR Code...', tone: 'normal' });

    try {
      const qrText = await decodeQRFromImage(file);
      if (qrText) {
        const parsed = parseTaiwanInvoiceQR(qrText);
        if (parsed?.data && parsed.data.invoiceNumber) {
          handleInvoice(parsed.data);
          return;
        } else if (parsed?.isRightSide) {
          setHint({ text: '這張照片辨識到的是「右側」明細 QR Code，請改拍包含「左側」QR Code 的照片。', tone: 'warn' });
          return;
        }
      }

      // 未找到 QR Code
      if (hasApiKey && onFallbackToAi) {
        setHint({ text: '未偵測到 QR Code，正在使用 Gemini AI 辨識圖片...', tone: 'normal' });
        const error = await onFallbackToAi(file);
        if (error) {
          setHint({ text: error, tone: 'warn' });
        } else {
          stopCamera();
          onClose();
        }
      } else {
        setHint({ text: '照片中未偵測到電子發票 QR Code，請對準「左側」QR Code 重試，或關閉視窗手動輸入號碼。', tone: 'warn' });
      }
    } catch (err) {
      console.error(err);
      setHint({ text: '圖片解析失敗，請重新嘗試。', tone: 'warn' });
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  const winCount = scannedList.filter(item => item.result?.isMatch).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="掃描電子發票 QR Code">
      <div className="bg-gray-900 w-full max-w-md max-h-full rounded-2xl overflow-hidden shadow-2xl border border-gray-800 flex flex-col relative">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 text-white">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
            <h3 className="font-bold text-lg">掃描電子發票 QR Code</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            aria-label="關閉掃描視窗"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Viewfinder area */}
        <div className="relative aspect-[4/3] bg-black overflow-hidden flex items-center justify-center shrink-0">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Scanner Overlay Box */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-56 h-56 border-2 border-indigo-400/80 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              {/* Corner accents */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-indigo-500 rounded-tl-lg"></div>
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-indigo-500 rounded-tr-lg"></div>
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-indigo-500 rounded-bl-lg"></div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-indigo-500 rounded-br-lg"></div>
              {/* Scanning laser beam animation */}
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent shadow-[0_0_8px_rgba(99,102,241,0.8)] absolute top-0 animate-[scan_2s_ease-in-out_infinite]"></div>
            </div>
          </div>

          {/* Camera Error Message */}
          {cameraError && (
            <div className="absolute inset-0 bg-gray-900/90 flex flex-col items-center justify-center p-6 text-center text-gray-300 z-10">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-500 mb-3"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
              <p className="text-sm leading-relaxed mb-4">{cameraError}</p>
              <button
                onClick={startCamera}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                重新啟動相機
              </button>
            </div>
          )}
        </div>

        {/* Footer info & Actions */}
        <div className="p-4 bg-gray-950 flex flex-col gap-3 overflow-y-auto">
          <div className={`text-center text-sm font-medium ${hint.tone === 'warn' ? 'text-amber-300' : 'text-indigo-300'}`} role="status" aria-live="polite">
            {hint.text}
          </div>

          <label className="flex items-center justify-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={continuous} onChange={toggleContinuous} className="w-4 h-4 accent-indigo-500" />
            連續掃描（掃完一張不關閉，適合一次對一疊發票）
          </label>

          {continuous && scannedList.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-3">
              <div className="text-xs text-gray-400 mb-2">
                本次已掃描 {scannedList.length} 張{winCount > 0 ? `，其中 ${winCount} 張中獎／疑似中獎` : ''}
              </div>
              <ul className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
                {scannedList.map(item => (
                  <li key={item.data.fullNumber || item.data.invoiceNumber} className="flex justify-between text-sm">
                    <span className="font-mono text-gray-200">{item.data.fullNumber || item.data.invoiceNumber}</span>
                    <span className={item.result?.isMatch ? 'text-amber-300 font-bold' : 'text-gray-500'}>
                      {item.result ? resultLabel(item.result) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileSelect}
            />
            <button
              type="button"
              disabled={isProcessingFile}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-3 px-4 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors border border-gray-700 active:scale-95"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              <span>{isProcessingFile ? '讀取圖片中...' : '從相簿/檔案選擇'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-3 px-5 bg-gray-800/80 hover:bg-gray-700 text-gray-400 text-sm font-semibold rounded-xl transition-colors"
            >
              {continuous && scannedList.length > 0 ? '完成' : '取消'}
            </button>
          </div>

          <div className="text-center text-xs text-gray-500 mt-1">
            提示：電子發票有左右兩個 QR Code，掃描「左側」條碼即可自動對獎與記帳
          </div>
        </div>
      </div>
    </div>
  );
};
