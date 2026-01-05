// Type definitions for Google Identity Services
declare const google: any;

export interface GmailMessage {
  id: string;
  snippet: string;
  internalDate: string;
  parsedNumber?: string; // The 8 digits for checking
  fullNumber?: string;   // The full string (e.g. AB-12345678) for display
  subject?: string;
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

const extractInvoiceNumberFromText = (text: string): { parsedNumber: string; fullNumber: string } | null => {
  if (!text) return null;
  const normalized = text.toUpperCase();
  const labeledRegex = /發票號碼[:：\s]*([A-Z]{2}[- ]?\d{8})/;
  const strictRegex = /[A-Z]{2}[- ]?(\d{8})/;
  const looseRegex = /號碼[:：\s]*([A-Z0-9-]{8,11})/;

  const labeledMatch = normalized.match(labeledRegex);
  if (labeledMatch && labeledMatch[1]) {
    const fullNumber = labeledMatch[1];
    const parsedNumber = fullNumber.replace(/[^0-9]/g, '');
    if (parsedNumber.length === 8) {
      return { parsedNumber, fullNumber };
    }
  }

  const strictMatch = normalized.match(strictRegex);
  if (strictMatch && strictMatch[1]) {
    return { parsedNumber: strictMatch[1], fullNumber: strictMatch[0] };
  }

  const looseMatch = normalized.match(looseRegex);
  if (looseMatch && looseMatch[1]) {
    const parsedNumber = looseMatch[1].replace(/[^0-9]/g, '');
    if (parsedNumber.length === 8) {
      return { parsedNumber, fullNumber: looseMatch[1] };
    }
  }

  return null;
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

const extractInvoiceFromPayloadFilenames = (payload: any): { parsedNumber: string; fullNumber: string } | null => {
  if (!payload) return null;
  const stack: any[] = [payload];
  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;
    if (Array.isArray(part.parts)) {
      stack.push(...part.parts);
    }
    const candidates = getFilenameCandidates(part);
    for (const name of candidates) {
      const match = extractInvoiceNumberFromText(name);
      if (match) return match;
    }
  }
  return null;
};

const extractInvoiceFromPayloadText = (payload: any): { parsedNumber: string; fullNumber: string } | null => {
  if (!payload) return null;
  const stack: any[] = [payload];
  while (stack.length > 0) {
    const part = stack.pop();
    if (!part) continue;
    if (Array.isArray(part.parts)) {
      stack.push(...part.parts);
    }
    const mimeType = part.mimeType || '';
    const data = part.body?.data;
    if (data && (mimeType.startsWith('text/plain') || mimeType.startsWith('text/html'))) {
      const decoded = decodeBase64Url(data);
      const match = extractInvoiceNumberFromText(decoded);
      if (match) return match;
    }
  }
  return null;
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

/**
 * Fetch list of messages with a custom query using pagination
 * @param query The Gmail search query (e.g. "label:電子發票 after:...")
 * @param maxCount Maximum number of emails to fetch (safety limit)
 */
export const fetchInvoiceEmails = async (query: string, maxCount: number = 2000): Promise<GmailMessage[]> => {
  if (!accessToken) throw new Error("No access token");

  const encodedQuery = encodeURIComponent(query);
  let messages: GmailMessage[] = [];
  let nextPageToken: string | undefined = undefined;
  
  // Pagination loop
  do {
    // Determine how many to ask for in this page (max 500 per call supported by API)
    const currentMax = 500;
    
    let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodedQuery}&maxResults=${currentMax}`;
    if (nextPageToken) {
      url += `&pageToken=${nextPageToken}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Gmail API Error: ${response.statusText}`);
    }

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
export const fetchMessageDetails = async (messageId: string): Promise<GmailMessage | null> => {
  if (!accessToken) throw new Error("No access token");

  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    const snippet = data.snippet;
    const internalDate = data.internalDate;
    
    // Get Subject
    const headers = data.payload?.headers || [];
    const subjectHeader = headers.find((h: any) => h.name === 'Subject');
    const subject = subjectHeader ? subjectHeader.value : '無主旨';

    // Get Body (Prefer plain text, then snippet)
    // Decoding Base64URL is complex, snippet is usually enough for the invoice number 
    // because invoice numbers usually appear early in the email or are distinct.
    // However, regex on snippet is safer for performance.
    
    let parsedNumber = null;
    let fullNumber = null;

    const subjectMatch = extractInvoiceNumberFromText(subject);
    const filenameMatch = subjectMatch ? null : extractInvoiceFromPayloadFilenames(data.payload);
    const snippetMatch = subjectMatch || filenameMatch ? null : extractInvoiceNumberFromText(snippet);
    const payloadMatch =
      subjectMatch || filenameMatch || snippetMatch ? null : extractInvoiceFromPayloadText(data.payload);

    const match = subjectMatch || filenameMatch || snippetMatch || payloadMatch;
    if (match) {
      parsedNumber = match.parsedNumber;
      fullNumber = match.fullNumber;
    }

    return {
      id: messageId,
      snippet,
      internalDate,
      subject,
      parsedNumber: parsedNumber || undefined,
      fullNumber: fullNumber || parsedNumber || undefined
    };

  } catch (e) {
    console.error(`Failed to fetch message ${messageId}`, e);
    return null;
  }
};
