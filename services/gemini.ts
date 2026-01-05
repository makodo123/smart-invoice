import { GoogleGenAI } from "@google/genai";
import { WinningNumbers } from '../types';

// Initialize Gemini Client (Only used for Image Recognition now)
const getClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const CACHE_KEY = 'invoice_winning_numbers_cache_v2';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Parsed structure helper
 */
const parseChineseNumbers = (description: string, key: string): string[] => {
  // Regex to find the key (e.g., "頭獎") followed by a colon (full or half width)
  // and then capture the numbers (digits separated by 、)
  const regex = new RegExp(`${key}[：:]\\s*([0-9、]+)`);
  const match = description.match(regex);
  if (match && match[1]) {
    return match[1].split('、').map(s => s.trim()).filter(s => s.length > 0);
  }
  return [];
};

/**
 * Fetches the latest winning numbers.
 * Priority:
 * 1. Force Refresh (User clicked button) -> Network
 * 2. Valid Cache (Not expired) -> LocalStorage
 * 3. Expired Cache or No Cache -> Network
 */
export const fetchLatestWinningNumbers = async (forceRefresh = false): Promise<WinningNumbers[]> => {
  
  // 1. Try to load from Cache first if not forced
  if (!forceRefresh) {
    try {
      const cachedString = localStorage.getItem(CACHE_KEY);
      if (cachedString) {
        const { timestamp, data } = JSON.parse(cachedString);
        const age = Date.now() - timestamp;
        
        // Special logic for Draw Date (25th of Odd Months)
        // If today is draw day, and it's past 13:30, and cache is from before today's draw...
        const now = new Date();
        const isOddMonth = (now.getMonth() + 1) % 2 !== 0;
        const isDrawDay = now.getDate() === 25;
        const isAfterDrawTime = now.getHours() >= 13 || (now.getHours() === 13 && now.getMinutes() >= 30);
        
        const cacheDate = new Date(timestamp);
        const isCacheFromBeforeDraw = cacheDate.getDate() !== 25 || cacheDate.getMonth() !== now.getMonth();

        const shouldExpireForDraw = isOddMonth && isDrawDay && isAfterDrawTime && isCacheFromBeforeDraw;

        if (age < CACHE_DURATION && !shouldExpireForDraw) {
          console.log("Using cached winning numbers");
          return data as WinningNumbers[];
        } else {
          console.log("Cache expired or new draw available, fetching fresh data...");
        }
      }
    } catch (e) {
      console.warn("Failed to read cache", e);
      // Continue to fetch
    }
  }

  // 2. Network Fetch Logic
  const TARGET_URL = "https://invoice.etax.nat.gov.tw/invoice.xml";
  
  // List of CORS proxies to try in order. 
  const proxyUrls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(TARGET_URL)}&t=${Date.now()}`,
    `https://corsproxy.io/?${encodeURIComponent(TARGET_URL)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(TARGET_URL)}`
  ];

  let lastError: any = null;

  for (const url of proxyUrls) {
    try {
      console.log(`Fetching official data via: ${url}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn(`Proxy ${url} returned status ${response.status}`);
        continue;
      }

      const xmlText = await response.text();

      if (!xmlText.includes("<rss") && !xmlText.includes("<item")) {
        console.warn(`Invalid content received from ${url}`);
        continue;
      }

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const items = xmlDoc.querySelectorAll("item");

      if (items.length === 0) {
        console.warn("No items found in XML");
        continue;
      }

      const results: WinningNumbers[] = [];
      let count = 0;
      const maxPeriods = 3;

      for (let i = 0; i < items.length && count < maxPeriods; i++) {
        const item = items[i];
        const title = item.querySelector("title")?.textContent || "";
        const description = item.querySelector("description")?.textContent || "";

        if (!title.includes("年") || !title.includes("月")) continue;

        const periodClean = title.replace("統一發票中獎號碼單", "").trim();
        
        const specialPrizeArr = parseChineseNumbers(description, "特別獎");
        const grandPrizeArr = parseChineseNumbers(description, "特獎");
        const firstPrizeArr = parseChineseNumbers(description, "頭獎");
        const additionalSixthPrizeArr = parseChineseNumbers(description, "增開六獎");

        if (specialPrizeArr.length > 0 && grandPrizeArr.length > 0) {
          results.push({
            period: periodClean,
            specialPrize: specialPrizeArr[0],
            grandPrize: grandPrizeArr[0],
            firstPrize: firstPrizeArr,
            additionalSixthPrize: additionalSixthPrizeArr
          });
          count++;
        }
      }

      if (results.length > 0) {
        // SAVE TO CACHE
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: results
          }));
        } catch (e) {
          console.error("Failed to save cache", e);
        }

        return results; 
      } else {
        console.warn(`Parsed 0 valid results from ${url}`);
      }

    } catch (error) {
      console.warn(`Failed to fetch via ${url}:`, error);
      lastError = error;
    }
  }

  // If we reach here, check if we have STALE cache as a fallback?
  // Option: If network fails but we have old cache, return old cache with a warning?
  // For now, we throw error so user can retry, but let's check cache one last time
  const staleCache = localStorage.getItem(CACHE_KEY);
  if (staleCache) {
      console.warn("Network failed, falling back to stale cache");
      const { data } = JSON.parse(staleCache);
      return data;
  }

  console.error("All proxies failed. Last error:", lastError);
  throw new Error("無法連線至財政部資料來源，請檢查網路連線或稍後再試。");
};

/**
 * Analyzes an uploaded image to extract the invoice number using Vision capabilities.
 * Uses Gemini 2.5 Flash Image model.
 */
export const extractInvoiceNumber = async (base64Image: string, mimeType: string): Promise<string | null> => {
  const ai = getClient();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType
            }
          },
          {
            text: "Identify the 8-digit Taiwan Uniform Invoice number (統一發票號碼) from this image. Return ONLY the 8-digit number as a string. If not found, return 'null'."
          }
        ]
      }
    });

    const text = response.text?.trim();
    if (!text || text.toLowerCase() === 'null') return null;
    
    const cleaned = text.replace(/\D/g, '');
    return cleaned.length === 8 ? cleaned : null;

  } catch (error) {
    console.error("Error analyzing invoice image:", error);
    return null;
  }
};
