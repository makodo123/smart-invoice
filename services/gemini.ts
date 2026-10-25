import { WinningNumbers, InvoiceData } from '../types';

const GEMINI_KEY_STORAGE = 'gemini_api_key';

/**
 * 金鑰來源：開發環境的 .env.local（正式版預設不打包進前端，避免金鑰外流），
 * 或使用者在畫面上自行輸入、只存在自己瀏覽器的金鑰。
 */
export const getGeminiApiKey = (): string => {
  const builtIn = (process.env.API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (builtIn) return builtIn;
  try {
    return (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
  } catch {
    return '';
  }
};

export const hasBuiltInGeminiApiKey = (): boolean =>
  Boolean((process.env.API_KEY || process.env.GEMINI_API_KEY || '').trim());

export const setUserGeminiApiKey = (key: string) => {
  try {
    if (key.trim()) localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch (error) {
    console.warn('Unable to save Gemini API key', error);
  }
};


// Bump the key so an older cache (v5 could hold the built-in fallback marked as fresh) is not reused.
const CACHE_KEY = 'invoice_winning_numbers_cache_v6';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * live：本次從資料來源取得（或 1 小時內的快取）
 * cache：所有來源失敗，改用先前成功下載的舊快取
 * fallback：所有來源失敗且無快取，改用程式內建獎號
 */
export type WinningNumbersSource = 'live' | 'cache' | 'fallback';

export interface WinningNumbersResult {
  data: WinningNumbers[];
  source: WinningNumbersSource;
  /** 資料下載時間（fallback 為 null） */
  fetchedAt: number | null;
}

type PrizeLabel = '特別獎' | '特獎' | '頭獎' | '增開六獎';

const labels: PrizeLabel[] = ['特別獎', '特獎', '頭獎', '增開六獎'];

/**
 * 預載/備用官方中獎號碼：所有資料來源都失敗且沒有快取時使用。
 * 只涵蓋下列期別，之後新開獎的期別需連線取得。
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
  const timeout = window.setTimeout(() => controller.abort(), 6_000);

  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    window.clearTimeout(timeout);
  }
};

/** 解析官方 RSS，取最新 3 期；格式不符時丟出錯誤 */
const parseWinningNumbersFeed = (xmlText: string): WinningNumbers[] => {
  const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");
  const items = xmlDoc.querySelectorAll("item");
  const results: WinningNumbers[] = [];
  for (let i = 0; i < items.length && results.length < 3; i++) {
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
    }
  }
  if (results.length === 0 || !results.every(isWinningNumbers)) throw new Error('Feed has no valid winning numbers');
  return results;
};

/** 讀取先前下載的獎號（不論是否過期），讓畫面在連線更新前先能使用 */
export const getCachedWinningNumbers = (): { data: WinningNumbers[]; fetchedAt: number | null } | null => {
  try {
    const cachedString = localStorage.getItem(CACHE_KEY);
    if (!cachedString) return null;
    const { timestamp, data } = JSON.parse(cachedString);
    if (Array.isArray(data) && data.length > 0 && data.every(isWinningNumbers)) {
      return { data, fetchedAt: typeof timestamp === 'number' ? timestamp : null };
    }
  } catch (error) {
    console.warn('Cache read failed', error);
  }
  return null;
};

/**
 * Fetches the latest winning numbers.
 */
export const fetchLatestWinningNumbers = async (forceRefresh = false): Promise<WinningNumbersResult> => {
  if (!forceRefresh) {
    try {
      const cachedString = localStorage.getItem(CACHE_KEY);
      if (cachedString) {
        const { timestamp, data } = JSON.parse(cachedString);
        const age = Date.now() - timestamp;
        if (age < CACHE_DURATION && Array.isArray(data) && data.every(isWinningNumbers)) {
          return { data, source: 'live', fetchedAt: timestamp };
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

  // 同時向所有來源發出請求，採用最先回傳有效資料的一個，避免逐一等待逾時
  try {
    const results = await Promise.any(sourceUrls.map(async (url) => {
      try {
        return parseWinningNumbersFeed(await fetchText(url));
      } catch (e) {
        console.warn(`Source ${url} failed`, e);
        throw e;
      }
    }));
    const fetchedAt = Date.now();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: fetchedAt, data: results }));
    return { data: results, source: 'live', fetchedAt };
  } catch {
    // 全部來源失敗，往下改用快取或內建資料
  }

  // 所有來源都失敗：改用舊快取，並標記為離線資料
  const cached = getCachedWinningNumbers();
  if (cached) return { data: cached.data, source: 'cache', fetchedAt: cached.fetchedAt };

  // 完全無快取：回傳內建獎號。不寫入快取，下次開啟時仍會重新嘗試所有來源。
  return { data: FALLBACK_WINNING_NUMBERS, source: 'fallback', fetchedAt: null };
};

export const hasGeminiApiKey = (): boolean => getGeminiApiKey().length > 0;

/**
 * Analyzes an invoice image using Gemini Flash to extract structured data.
 */
export const analyzeInvoice = async (base64Image: string, mimeType: string): Promise<InvoiceData | null> => {
  if (!hasGeminiApiKey()) {
    console.warn("未設定 Gemini API Key，跳過 AI 圖片解析。");
    return null;
  }

  // 只有使用 AI 辨識時才載入 Gemini SDK，減少首次開啟的下載量
  const { GoogleGenAI, ThinkingLevel, Type } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: {
        parts: [
          { inlineData: { data: base64Image, mimeType: mimeType } },
          { text: "請分析這張台灣統一發票，並提取：發票號碼(8碼)、日期(YYYY/MM/DD)、總金額(數字)、商家名稱。找不到發票號碼或總金額時，該欄位填 null。" }
        ]
      },
      config: {
        // 只是從照片讀出號碼與金額，不需要推理；3.6 Flash 預設會用中等思考，調到最低讓掃描更快
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            invoiceNumber: { type: Type.STRING, nullable: true, description: "8-digit invoice number only; null if not found" },
            date: { type: Type.STRING, description: "Date in YYYY/MM/DD format" },
            amount: { type: Type.NUMBER, nullable: true, description: "Total amount; null if not found" },
            storeName: { type: Type.STRING, description: "Store name" }
          },
          required: ["invoiceNumber", "amount"]
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    
    const data = JSON.parse(text) as InvoiceData;
    // Basic validation
    if (!data.invoiceNumber || data.invoiceNumber.length !== 8) return null;

    // 找不到金額時用 0，與 QR Code 解析一致（畫面會顯示「無紀錄」）
    return { ...data, amount: data.amount ?? 0 };

  } catch (error) {
    console.error("Error analyzing invoice:", error);
    return null;
  }
};
