// Type definitions for Google Identity Services
declare const google: any;

export interface GmailMessage {
  id: string;
  snippet: string;
  internalDate: string;
  parsedNumber?: string; // The 8 digits for checking
  fullNumber?: string;   // The full string (e.g. AB-12345678) for display
  subject?: string;
  invoices?: InvoiceNumber[];
  attachmentErrors?: number;
  /** 信件或附件中標示的發票日期（YYYY/MM/DD），用來判斷期別 */
  invoiceDate?: string;
}

/** Gmail 授權過期或被撤銷（HTTP 401），需要重新登入 */
export class GmailAuthError extends Error {
  constructor(message = 'Gmail 授權已過期，請重新連結 Gmail。') {
    super(message);
    this.name = 'GmailAuthError';
  }
}

const gmailFetch = async (url: string): Promise<Response> => {
  if (!accessToken) throw new GmailAuthError();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) {
    accessToken = null;
    throw new GmailAuthError();
  }
  if (!response.ok) {
    // HTTP/2 回應沒有 statusText，所以一定要附上狀態碼
    throw new Error(`Gmail API 錯誤（HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}）`);
  }
  return response;
};

export interface InvoiceNumber {
  parsedNumber: string;
  fullNumber: string;
}

let tokenClient: any;
let accessToken: string | null = null;

const decodeBase64Url = (data: string): string => {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  try {
    const decoded = atob(padded);
    try {
      return decodeURIComponent(
        decoded
          .split('')
          .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join('')
      );
    } catch {
      return decoded;
    }
  } catch {
    return '';
  }
};

const decodeBase64UrlBytes = (data: string): Uint8Array => {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
};

export const extractInvoiceNumbersFromText = (text: string): InvoiceNumber[] => {
  if (!text) return [];
  const normalized = text.toUpperCase().replace(/&NBSP;|&#160;/g, ' ');
  const matches: InvoiceNumber[] = [];
  const seen = new Set<string>();
  const add = (letters: string, digits: string) => {
    const fullNumber = letters + digits;
    if (seen.has(fullNumber)) return;
    seen.add(fullNumber);
    matches.push({ parsedNumber: digits, fullNumber });
  };

  // Accept a number without its prefix only when it follows an invoice label.
  for (const match of normalized.matchAll(/(?:\u96fb\u5b50)?\u767c\u7968(?:\u5b57\u8ecc)?\u865f\u78bc\s*[:\uff1a]?\s*(?:([A-Z]{2})\s*[-\uff0d]?\s*)?(\d{8})(?!\d)/g)) {
    add(match[1] || '', match[2]);
  }
  // Collect every full number, including a second invoice in the same email.
  for (const match of normalized.matchAll(/(?<![A-Z0-9])([A-Z]{2})\s*[-\uff0d]?\s*(\d{8})(?!\d)/g)) {
    add(match[1], match[2]);
  }
  return matches;
};

/**
 * 找出「發票日期／開立日期」等標示後的日期，回傳 YYYY/MM/DD。支援西元與民國年。
 */
export const extractInvoiceDateFromText = (text: string): string | undefined => {
  if (!text) return undefined;
  const match = text.match(/(?:\u767c\u7968|\u958b\u7acb|\u4ea4\u6613|\u6d88\u8cbb)(?:\u65e5\u671f|\u6642\u9593)\s*[:\uff1a]?\s*(\d{3,4})\s*[\/\-.\u5e74]\s*(\d{1,2})\s*[\/\-.\u6708]\s*(\d{1,2})/);
  if (!match) return undefined;
  const rawYear = Number(match[1]);
  const year = rawYear >= 1911 ? rawYear : rawYear + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
};

const extractFilenamesFromHeader = (value: string): string[] => {
  if (!value) return [];
  const names: string[] = [];
  const utf8Match = value.match(/filename\*\s*=\s*([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    let raw = utf8Match[1].trim();
    raw = raw.replace(/^UTF-8''/i, '').replace(/^"|"$/g, '');
    try {
      names.push(decodeURIComponent(raw));
    } catch {
      names.push(raw);
    }
  }

  const filenameMatch = value.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (filenameMatch && filenameMatch[1]) {
    names.push(filenameMatch[1].trim());
  }

  const nameMatch = value.match(/name\s*=\s*"?([^";]+)"?/i);
  if (nameMatch && nameMatch[1]) {
    names.push(nameMatch[1].trim());
  }

  return names;
};

const getFilenameCandidates = (part: any): string[] => {
  const candidates: string[] = [];
  if (part?.filename) candidates.push(part.filename);

  const headers = Array.isArray(part?.headers) ? part.headers : [];
  for (const header of headers) {
    if (!header || typeof header.name !== 'string' || typeof header.value !== 'string') continue;
    const headerName = header.name.toLowerCase();
    if (headerName === 'content-disposition' || headerName === 'content-type') {
      candidates.push(...extractFilenamesFromHeader(header.value));
    }
  }

  return candidates.filter(Boolean);
};

const extractInvoicesFromPayloadFilenames = (payload: any): InvoiceNumber[] => {
  if (!payload) return [];
  const matches: InvoiceNumber[] = [];
  const stack: any[] = [payload];
  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;
    if (Array.isArray(part.parts)) stack.push(...part.parts);
    for (const name of getFilenameCandidates(part)) {
      matches.push(...extractInvoiceNumbersFromText(name));
    }
  }
  return matches;
};

const getPayloadTexts = (payload: any): string[] => {
  if (!payload) return [];
  const texts: string[] = [];
  const stack: any[] = [payload];
  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;
    if (Array.isArray(part.parts)) stack.push(...part.parts);
    const mimeType = part.mimeType || '';
    const data = part.body?.data;
    if (data && (mimeType.startsWith('text/plain') || mimeType.startsWith('text/html'))) {
      texts.push(decodeBase64Url(data).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' '));
    }
  }
  return texts;
};

const extractInvoicesFromPayloadText = (payload: any): InvoiceNumber[] => {
  if (!payload) return [];
  const matches: InvoiceNumber[] = [];
  const stack: any[] = [payload];
  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;
    if (Array.isArray(part.parts)) stack.push(...part.parts);
    const mimeType = part.mimeType || '';
    const data = part.body?.data;
    if (data && (mimeType.startsWith('text/plain') || mimeType.startsWith('text/html'))) {
      const decoded = decodeBase64Url(data);
      matches.push(...extractInvoiceNumbersFromText(decoded.replace(/<[^>]*>/g, ' ')));
    }
  }
  return matches;
};

export const extractInvoiceNumbersFromMessage = (subject: string, snippet: string, payload: any): InvoiceNumber[] => {
  const all = [
    ...extractInvoicesFromPayloadText(payload),
    ...extractInvoicesFromPayloadFilenames(payload),
    ...extractInvoiceNumbersFromText(subject),
    ...extractInvoiceNumbersFromText(snippet),
  ];
  return [...new Map(all.map(invoice => [invoice.fullNumber, invoice])).values()];
};

const getPdfParts = (payload: any): any[] => {
  if (!payload) return [];
  const pdfParts: any[] = [];
  const stack = [payload];
  while (stack.length) {
    const part = stack.pop();
    if (!part) continue;
    if (Array.isArray(part.parts)) stack.push(...part.parts);
    const names = getFilenameCandidates(part);
    if (part.mimeType?.toLowerCase() === 'application/pdf' || names.some(name => /\.pdf$/i.test(name))) {
      pdfParts.push(part);
    }
  }
  return pdfParts;
};

const extractPdfInvoices = async (messageId: string, payload: any): Promise<{ invoices: InvoiceNumber[]; errors: number; invoiceDate?: string }> => {
  const pdfParts = getPdfParts(payload);
  if (pdfParts.length === 0) return { invoices: [], errors: 0 };
  const { extractInvoicesFromPdf } = await import('./pdfInvoices.ts');
  const invoices: InvoiceNumber[] = [];
  let invoiceDate: string | undefined;
  let errors = 0;
  for (const part of pdfParts) {
    try {
      let data = part.body?.data;
      if (!data && part.body?.attachmentId) {
        const response = await gmailFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${encodeURIComponent(part.body.attachmentId)}`
        );
        data = (await response.json()).data;
      }
      if (!data) throw new Error('PDF attachment has no data');
      const pdf = await extractInvoicesFromPdf(decodeBase64UrlBytes(data));
      invoices.push(...pdf.invoices);
      invoiceDate ??= pdf.invoiceDate;
    } catch (error) {
      if (error instanceof GmailAuthError) throw error;
      console.warn('Unable to read an invoice PDF attachment', error);
      errors++;
    }
  }
  return { invoices, errors, invoiceDate };
};

/**
 * Initialize the Google OAuth 2.0 Token Client
 * @param clientId The Google Cloud OAuth Client ID
 * @param callback Function to run after successful login
 */
export const initTokenClient = (clientId: string, callback: (token: string) => void) => {
  if (!(window as any).google) return;
  
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    callback: (response: any) => {
      if (response.access_token) {
        accessToken = response.access_token;
        callback(response.access_token);
      }
    },
  });
};

/**
 * Trigger the login popup
 */
export const requestAccessToken = () => {
  if (tokenClient) {
    tokenClient.requestAccessToken();
  } else {
    throw new Error("Token client not initialized");
  }
};

/** Remove the in-memory token and revoke the user's consent with Google. */
export const revokeAccessToken = async (): Promise<void> => {
  if (!accessToken || !(window as any).google) {
    accessToken = null;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    google.accounts.oauth2.revoke(accessToken, (response: any) => {
      accessToken = null;
      if (response?.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }
      resolve();
    });
  });
};

/**
 * Fetch list of messages with a custom query using pagination
 * @param query The Gmail search query (e.g. "label:電子發票 after:...")
 * @param maxCount Maximum number of emails to fetch (safety limit)
 */
export const fetchInvoiceEmails = async (query: string, maxCount: number = 200): Promise<GmailMessage[]> => {
  const encodedQuery = encodeURIComponent(query);
  let messages: GmailMessage[] = [];
  let nextPageToken: string | undefined = undefined;
  
  // Pagination loop
  do {
    // A smaller page keeps scans responsive while remaining below Gmail's 500 limit.
    const currentMax = Math.min(100, maxCount - messages.length);
    
    let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=${currentMax}`;
    if (nextPageToken) {
      url += `&pageToken=${nextPageToken}`;
    }

    const response = await gmailFetch(url);
    const data = await response.json();
    
    if (data.messages && Array.isArray(data.messages)) {
      messages = [...messages, ...data.messages];
    }

    nextPageToken = data.nextPageToken;

    // Safety break if we exceed the requested maxCount
    if (messages.length >= maxCount) break;

  } while (nextPageToken);

  return messages;
};

/**
 * Fetch details for a specific message and try to extract the invoice number
 */
export const fetchMessageDetails = async (messageId: string): Promise<GmailMessage> => {
  const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`);
  const data = await response.json();
  const snippet = data.snippet || '';
  const internalDate = data.internalDate;

  const headers = data.payload?.headers || [];
  const subjectHeader = headers.find((h: any) => h.name?.toLowerCase() === 'subject');
  const subject = subjectHeader ? subjectHeader.value : '\u7121\u4e3b\u65e8';
  const textInvoices = extractInvoiceNumbersFromMessage(subject, snippet, data.payload);
  const pdf = await extractPdfInvoices(messageId, data.payload);
  const invoices = [...new Map([...textInvoices, ...pdf.invoices].map(invoice => [invoice.fullNumber, invoice])).values()];
  const invoiceDate = [...getPayloadTexts(data.payload), subject, snippet]
    .map(extractInvoiceDateFromText)
    .find(Boolean) ?? pdf.invoiceDate;

  return {
    id: messageId,
    snippet,
    internalDate,
    subject,
    invoices,
    attachmentErrors: pdf.errors,
    invoiceDate,
    parsedNumber: invoices[0]?.parsedNumber,
    fullNumber: invoices[0]?.fullNumber
  };
};
