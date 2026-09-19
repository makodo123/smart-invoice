import jsQR from 'jsqr';
import { InvoiceData } from '../types';

export interface QRInvoiceResult {
  success: boolean;
  data?: InvoiceData;
  isRightSide?: boolean;
  rawText?: string;
  errorMessage?: string;
}

/**
 * 解析台灣電子發票 QR Code
 */
export const parseTaiwanInvoiceQR = (text: string): { data?: InvoiceData; isRightSide?: boolean } | null => {
  if (!text) return null;
  const raw = text.trim();

  // 若為右側 QR Code（通常以 ** 開頭）
  if (raw.startsWith('**')) {
    return { isRightSide: true };
  }

  // 台灣電子發票標準左側 QR Code（至少 77 碼）
  // 格式：[字軌2碼][號碼8碼][民國年月日7碼][隨機碼4碼][未稅銷售額16進位8碼][總額16進位8碼][買方統編8碼][賣方統編8碼]...
  const invoiceRegex = /^([A-Za-z]{2})(\d{8})(\d{3})(\d{2})(\d{2})([0-9A-Za-z]{4})([0-9A-Fa-f]{8})([0-9A-Fa-f]{8})/;
  const match = raw.match(invoiceRegex);

  if (match) {
    const [, prefix, num, rocYear, month, day, , , totalHex] = match;
    const year = parseInt(rocYear, 10) + 1911;
    const amount = parseInt(totalHex, 16);

    return {
      data: {
        invoiceNumber: num,
        date: `${year}/${month}/${day}`,
        amount: isNaN(amount) ? 0 : amount,
        storeName: `${prefix.toUpperCase()} 電子發票`
      }
    };
  }

  // 寬鬆解析：2 碼英文字軌 + 8 碼數字
  const looseMatch = raw.match(/([A-Za-z]{2})(\d{8})/);
  if (looseMatch) {
    return {
      data: {
        invoiceNumber: looseMatch[2],
        date: '',
        amount: 0,
        storeName: `${looseMatch[1].toUpperCase()} 電子發票`
      }
    };
  }

  // 純 8 碼發票號碼
  const numMatch = raw.match(/^\d{8}$/);
  if (numMatch) {
    return {
      data: {
        invoiceNumber: numMatch[0],
        date: '',
        amount: 0,
        storeName: '電子發票'
      }
    };
  }

  return null;
};

/**
 * 從 HTMLCanvas 讀取並用 jsQR 辨識
 */
const scanCanvas = (canvas: HTMLCanvasElement): string | null => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  });
  return code ? code.data : null;
};

/**
 * 從圖片檔案中解碼 QR Code（包含多解析度嘗試以提升辨識率）
 */
export const decodeQRFromImage = async (file: File): Promise<string | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // 嘗試不同縮放尺寸以兼顧效能與高解像度 QR Code 辨識
        const targetSizes = [1000, 1600, Math.max(img.width, img.height)];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
          resolve(null);
          return;
        }

        for (const maxSize of targetSizes) {
          let width = img.width;
          let height = img.height;

          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            } else {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const result = scanCanvas(canvas);
          if (result) {
            resolve(result);
            return;
          }
        }

        resolve(null);
      };
      img.onerror = () => resolve(null);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};
