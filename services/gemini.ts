import { GoogleGenAI, SchemaType } from "@google/genai";
import { WinningNumbers, InvoiceData } from '../types';

// Initialize Gemini Client
const getClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const CACHE_KEY = 'invoice_winning_numbers_cache_v2';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parsed structure helper
 */
const parseChineseNumbers = (description: string, key: string): string[] => {
  const regex = new RegExp(`${key}[：:]\\s*([0-9、]+)`);
  const match = description.match(regex);
  if (match && match[1]) {
    return match[1].split('、').map(s => s.trim()).filter(s => s.length > 0);
  }
  return [];
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
        if (age < CACHE_DURATION) return data;
      }
    } catch (e) { console.warn("Cache read failed", e); }
  }

  const TARGET_URL = "https://invoice.etax.nat.gov.tw/invoice.xml";
  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(TARGET_URL)}&t=${Date.now()}`,
    `https://corsproxy.io/?${encodeURIComponent(TARGET_URL)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(TARGET_URL)}`
  ];

  for (const url of proxyUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const xmlText = await response.text();
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

        const periodClean = title.replace("統一發票中獎號碼單", "").trim();
        const special = parseChineseNumbers(description, "特別獎");
        const grand = parseChineseNumbers(description, "特獎");
        const first = parseChineseNumbers(description, "頭獎");
        const sixth = parseChineseNumbers(description, "增開六獎");

        if (special.length > 0) {
          results.push({
            period: periodClean,
            specialPrize: special[0],
            grandPrize: grand[0],
            firstPrize: first,
            additionalSixthPrize: sixth
          });
          count++;
        }
      }

      if (results.length > 0) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: results }));
        return results;
      }
    } catch (e) { console.warn(`Proxy ${url} failed`, e); }
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
          type: SchemaType.OBJECT,
          properties: {
            invoiceNumber: { type: SchemaType.STRING, description: "8-digit invoice number only" },
            date: { type: SchemaType.STRING, description: "Date in YYYY/MM/DD format" },
            amount: { type: SchemaType.NUMBER, description: "Total amount" },
            storeName: { type: SchemaType.STRING, description: "Store name" }
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
