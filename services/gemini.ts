import { GoogleGenAI, Type } from "@google/genai";
import { WinningNumbers, InvoiceData } from '../types';

// Initialize Gemini Client
const getClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Bump the key so an older cache containing partially-parsed numbers is not reused.
const CACHE_KEY = 'invoice_winning_numbers_cache_v5';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

type PrizeLabel = '特別獎' | '特獎' | '頭獎' | '增開六獎';

const labels: PrizeLabel[] = ['特別獎', '特獎', '頭獎', '增開六獎'];

/**
 * 預載/備用官方中獎號碼（確保離線、靜態託管或財政部主機連線異常時，使用者仍可正常對獎）
 */
export const FALLBACK_WINNING_NUMBERS: WinningNumbers[] = [
  {
    period: '115年 07~08月',
    specialPrize: '89996565',
    grandPrize: '91098182',
    firstPrize: ['54348835', '44991397', '06595111'],
    additionalSixthPrize: []
  },
  {
    period: '115年 05~06月',
    specialPrize: '38548029',
    grandPrize: '10138845',
    firstPrize: ['24121106', '28589937', '83663333'],
    additionalSixthPrize: []
  },
  {
    period: '115年 03~04月',
    specialPrize: '19531471',
    grandPrize: '85941329',
    firstPrize: ['07225810', '20231230', '83518781'],
    additionalSixthPrize: []
  },
  {
    period: '115年 01~02月',
    specialPrize: '87510041',
    grandPrize: '32220522',
    firstPrize: ['21677046', '44662410', '31262513'],
    additionalSixthPrize: []
  }
];

/**
 * The official RSS description is HTML (for example, `特獎：<br>10138 845`).
 * Read it as HTML before extracting numbers, rather than assuming the label is
 * immediately followed by unformatted digits.
 */
const toPlainText = (value: string): string => {
  const document = new DOMParser().parseFromString(value, 'text/html');
  return (document.body.textContent || '').replace(/\u00a0/g, ' ');
};

const fixedDigitNumbers = (value: string, digits: number): string[] =>
  value.match(new RegExp(`(?<!\\d)\\d(?:[\\s\\u00a0]*\\d){${digits - 1}}(?!\\d)`, 'g'))
    ?.map(number => number.replace(/\D/g, '')) ?? [];

const parsePrizeNumbers = (description: string): Record<PrizeLabel, string[]> => {
  const text = toPlainText(description);
  const positions = Array.from(text.matchAll(/(特別獎|特獎|頭獎|增開六獎)[：:]/g));
  const prizes = Object.fromEntries(labels.map(label => [label, []])) as Record<PrizeLabel, string[]>;

  positions.forEach((match, index) => {
    const label = match[1] as PrizeLabel;
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < positions.length ? positions[index + 1].index : text.length;
    prizes[label] = fixedDigitNumbers(text.slice(start, end), label === '增開六獎' ? 3 : 8);
  });

  return prizes;
};

const isWinningNumbers = (value: unknown): value is WinningNumbers => {
  const data = value as WinningNumbers;
  return Boolean(
    data &&
    typeof data.period === 'string' &&
    /^\d{8}$/.test(data.specialPrize) &&
    /^\d{8}$/.test(data.grandPrize) &&
    Array.isArray(data.firstPrize) &&
    data.firstPrize.length > 0 &&
    data.firstPrize.every(number => /^\d{8}$/.test(number)) &&
    Array.isArray(data.additionalSixthPrize) &&
    data.additionalSixthPrize.every(number => /^\d{3}$/.test(number))
  );
};

const fetchText = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    window.clearTimeout(timeout);
  }
};

/**
 * Fetches the latest winning numbers.
 */
export const fetchLatestWinningNumbers = async (forceRefresh = false): Promise<WinningNumbers[]> => {
  if (!forceRefresh) {
    try {
      const cachedString = localStorage.getItem(CACHE_KEY);
      if (cachedString) {
        const { timestamp, data } = JSON.parse(cachedString);
        const age = Date.now() - timestamp;
        if (age < CACHE_DURATION && Array.isArray(data) && data.every(isWinningNumbers)) {
          return data;
        }
      }
    } catch (e) {
      console.warn("Cache read failed", e);
    }
  }

  const TARGET_URL = "https://invoice.etax.nat.gov.tw/invoice.xml";
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  
  // GitHub Pages 沒有後端代理；GitHub raw 提供跨來源可讀的每日官方 RSS 快照。
  const sourceUrls = [
    `https://raw.githubusercontent.com/makodo123/smart-invoice/main/public/invoice.xml?t=${Date.now()}`,
    `${baseUrl}/invoice.xml`,
    `${baseUrl}/api/invoice.xml`,
    '/api/invoice.xml',
    TARGET_URL,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(TARGET_URL)}&t=${Date.now()}`
  ];

  for (const url of sourceUrls) {
    try {
      const xmlText = await fetchText(url);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const items = xmlDoc.querySelectorAll("item");
      if (items.length === 0) continue;

      const results: WinningNumbers[] = [];
      let count = 0;
      for (let i = 0; i < items.length && count < 3; i++) {
        const item = items[i];
        const title = item.querySelector("title")?.textContent || "";
        const description = item.querySelector("description")?.textContent || "";
        if (!title.includes("年") || !title.includes("月")) continue;

        const periodClean = toPlainText(title).replace("統一發票中獎號碼單", "").trim();
        const prizes = parsePrizeNumbers(description);

        if (prizes['特別獎'].length > 0 && prizes['特獎'].length > 0 && prizes['頭獎'].length > 0) {
          results.push({
            period: periodClean,
            specialPrize: prizes['特別獎'][0],
            grandPrize: prizes['特獎'][0],
            firstPrize: prizes['頭獎'],
            additionalSixthPrize: prizes['增開六獎']
          });
          count++;
        }
      }

      if (results.length > 0 && results.every(isWinningNumbers)) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: results }));
        return results;
      }
    } catch (e) {
      console.warn(`Source ${url} failed`, e);
    }
  }

  // 嘗試讀取舊快取
  try {
    const cachedString = localStorage.getItem(CACHE_KEY);
    if (cachedString) {
      const { data } = JSON.parse(cachedString);
      if (Array.isArray(data) && data.every(isWinningNumbers)) {
        if (forceRefresh) {
          throw new Error("無法連線至財政部即時資料來源，已保留現有獎號。");
        }
        return data;
      }
    }
  } catch (error: any) {
    if (forceRefresh) throw error;
    console.warn('Stale cache read failed', error);
  }

  // 若完全無快取可用，寫入並回傳預載 fallback 資料
  localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: FALLBACK_WINNING_NUMBERS }));
  if (forceRefresh) {
    throw new Error("無法取得官方資料，已載入內建備援獎號；請核對期別。");
  }
  return FALLBACK_WINNING_NUMBERS;
};

export const hasGeminiApiKey = (): boolean => {
  const key = process.env.API_KEY || process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 0);
};

/**
 * Analyzes an invoice image using Gemini 2.0 Flash to extract structured data.
 */
export const analyzeInvoice = async (base64Image: string, mimeType: string): Promise<InvoiceData | null> => {
  if (!hasGeminiApiKey()) {
    console.warn("未設定 Gemini API Key，跳過 AI 圖片解析。");
    return null;
  }

  const ai = getClient();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: mimeType } },
          { text: "請分析這張台灣統一發票，並提取：發票號碼(8碼)、日期(YYYY/MM/DD)、總金額(數字)、商家名稱。如果找不到發票號碼，請回傳 null。" }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            invoiceNumber: { type: Type.STRING, description: "8-digit invoice number only" },
            date: { type: Type.STRING, description: "Date in YYYY/MM/DD format" },
            amount: { type: Type.NUMBER, description: "Total amount" },
            storeName: { type: Type.STRING, description: "Store name" }
          },
          required: ["invoiceNumber", "amount"]
        }
      }
    });

    const text = response.text();
    if (!text) return null;
    
    const data = JSON.parse(text) as InvoiceData;
    // Basic validation
    if (!data.invoiceNumber || data.invoiceNumber.length !== 8) return null;
    
    return data;

  } catch (error) {
    console.error("Error analyzing invoice:", error);
    return null;
  }
};
