import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseTaiwanInvoiceQR, decodeQRFromImage } from '../utils/qrScanner';
import { InvoiceData } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (data: InvoiceData) => void;
  hasApiKey: boolean;
  onFallbackToAi?: (file: File) => Promise<void>;
}

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

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hintMessage, setHintMessage] = useState<string>('請對準電子發票「左側」QR Code');
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);

  const playBeep = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioCtx = new AudioContextClass();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
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
    setHintMessage('請對準電子發票「左側」QR Code');

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
        requestAnimationFrame(tick);
      }
    } catch (err: any) {
      console.warn('Camera access failed:', err);
      setCameraError('無法存取相機，請確認已允許瀏覽器相機權限，或使用「選擇圖片」上傳發票照片。');
    }
  };

  const tick = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code && code.data) {
        const parsed = parseTaiwanInvoiceQR(code.data);
        if (parsed) {
          if (parsed.isRightSide) {
            setHintMessage('⚠️ 偵測到右側商品明細，請對準「左側」QR Code');
          } else if (parsed.data && parsed.data.invoiceNumber) {
            playBeep();
            if (navigator.vibrate) navigator.vibrate(80);
            stopCamera();
            onScanSuccess(parsed.data);
            onClose();
            return;
          }
        }
      }
    }

    animationFrameId.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setHintMessage('正在分析發票 QR Code...');

    try {
      const qrText = await decodeQRFromImage(file);
      if (qrText) {
        const parsed = parseTaiwanInvoiceQR(qrText);
        if (parsed?.data && parsed.data.invoiceNumber) {
          playBeep();
          stopCamera();
          onScanSuccess(parsed.data);
          onClose();
          return;
        } else if (parsed?.isRightSide) {
          alert('這張照片辨識到的是電子發票「右側」明細 QR Code，請拍攝包含「左側」QR Code 的照片。');
          setHintMessage('請對準電子發票「左側」QR Code');
          return;
        }
      }

      // 未找到 QR Code
      if (hasApiKey && onFallbackToAi) {
        setHintMessage('未偵測到 QR Code，正在啟動 Gemini AI 視覺辨識...');
        await onFallbackToAi(file);
        stopCamera();
        onClose();
      } else {
        alert('未偵測到電子發票 QR Code。\n（因未設定 Gemini API 金鑰，不執行 AI 圖片解析，請對準 QR Code 重試或手動輸入號碼）');
        setHintMessage('未偵測到 QR Code，請對準「左側」QR Code');
      }
    } catch (err) {
      console.error(err);
      alert('圖片解析失敗，請重新嘗試。');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-gray-900 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border border-gray-800 flex flex-col relative">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 text-white">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
            <h3 className="font-bold text-lg">掃描電子發票 QR Code</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Viewfinder area */}
        <div className="relative aspect-[4/3] bg-black overflow-hidden flex items-center justify-center">
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
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-500 mb-3"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>
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
        <div className="p-4 bg-gray-950 flex flex-col gap-3">
          <div className="text-center text-sm font-medium text-indigo-300">
            {hintMessage}
          </div>

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
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              <span>{isProcessingFile ? '讀取圖片中...' : '從相簿/檔案選擇'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-3 px-5 bg-gray-800/80 hover:bg-gray-700 text-gray-400 text-sm font-semibold rounded-xl transition-colors"
            >
              取消
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
