import { GoogleGenAI, Type } from "@google/genai";
import { WinningNumbers, InvoiceData } from '../types';

// Initialize Gemini Client
const getClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Bump the key so an older cache containing partially-parsed numbers is not reused.
const CACHE_KEY = 'invoice_winning_numbers_cache_v3';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

type PrizeLabel = '特別獎' | '特獎' | '頭獎' | '增開六獎';

const labels: PrizeLabel[] = ['特別獎', '特獎', '頭獎', '增開六獎'];

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
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

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
        if (age < CACHE_DURATION && Array.isArray(data) && data.every(isWinningNumbers)) return data;
      }
    } catch (e) { console.warn("Cache read failed", e); }
  }

  const TARGET_URL = "https://invoice.etax.nat.gov.tw/invoice.xml";
  // Try the source directly first. The proxy list is only a CORS fallback for
  // static deployments; the data itself always comes from the official RSS.
  const sourceUrls = [
    // Vite proxies this path server-side in local development, avoiding CORS.
    ...(import.meta.env.DEV ? [`${import.meta.env.BASE_URL}api/invoice.xml`] : []),
    TARGET_URL,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(TARGET_URL)}&t=${Date.now()}`,
    `https://corsproxy.io/?${encodeURIComponent(TARGET_URL)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(TARGET_URL)}`
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
    } catch (e) { console.warn(`Proxy ${url} failed`, e); }
  }
  try {
    const cachedString = localStorage.getItem(CACHE_KEY);
    if (cachedString) {
      const { data } = JSON.parse(cachedString);
      if (Array.isArray(data) && data.every(isWinningNumbers)) return data;
    }
  } catch (error) {
    console.warn('Stale cache read failed', error);
  }

  throw new Error("無法連線至財政部資料來源，請檢查網路連線或稍後再試。");
};

/**
 * Analyzes an invoice image using Gemini 2.0 Flash to extract structured data.
 */
export const analyzeInvoice = async (base64Image: string, mimeType: string): Promise<InvoiceData | null> => {
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
