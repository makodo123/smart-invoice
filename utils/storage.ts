import { HistoryItem, InvoiceData } from '../types';

const KEY = 'invoice_history';
const DATA_KEY = 'smart_invoice_data';
const HISTORY_LIMIT = 50;
const INVOICE_DATA_LIMIT = 100;

/** 歷史紀錄或記帳資料變動時發出，讓不同區塊（手動對獎、Gmail）同步顯示 */
export const STORAGE_CHANGE_EVENT = 'smart-invoice-storage-change';

const notifyChange = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT));
};

const readList = <T,>(key: string): T[] => {
  try {
    const item = localStorage.getItem(key);
    const parsed = item ? JSON.parse(item) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeList = (key: string, list: unknown[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    console.error("Failed to save", key, e);
  }
  notifyChange();
};

export const getHistory = (): HistoryItem[] => readList<HistoryItem>(KEY);

const isSameCheck = (a: HistoryItem, b: HistoryItem) =>
  a.number === b.number && (a.result.period || '') === (b.result.period || '');

/** 新增一筆紀錄到最前面；同號碼、同期別的舊紀錄會被取代，不重複列出 */
export const saveHistoryItem = (item: HistoryItem): HistoryItem[] => {
  const history = getHistory().filter(existing => !isSameCheck(existing, item));
  const newHistory = [item, ...history].slice(0, HISTORY_LIMIT);
  saveHistoryList(newHistory);
  return newHistory;
};

/** 一次新增多筆（例如 Gmail 掃描），寫入前重新讀取，避免覆蓋其他區塊剛寫入的紀錄 */
export const addHistoryItems = (items: HistoryItem[]): HistoryItem[] => {
  if (items.length === 0) return getHistory();
  const history = getHistory().filter(existing => !items.some(item => isSameCheck(existing, item)));
  const newHistory = [...items, ...history].slice(0, HISTORY_LIMIT);
  saveHistoryList(newHistory);
  return newHistory;
};

/**
 * 打字時自動存檔：若上一筆是剛剛（editWindowMs 內）輸入、且號碼互為前綴（補字或退格修正），
 * 就更新那一筆，而不是新增一筆。
 */
export const upsertTypedHistoryItem = (item: HistoryItem, editWindowMs = 10_000): HistoryItem[] => {
  const history = getHistory();
  const last = history[0];
  if (last && isSameCheck(last, item)) return history;
  const isEditOfLast =
    last &&
    item.timestamp - last.timestamp < editWindowMs &&
    (item.number.startsWith(last.number) || last.number.startsWith(item.number));
  const rest = (isEditOfLast ? history.slice(1) : history).filter(existing => !isSameCheck(existing, item));
  const newHistory = [item, ...rest].slice(0, HISTORY_LIMIT);
  saveHistoryList(newHistory);
  return newHistory;
};

export const saveHistoryList = (list: HistoryItem[]) => {
  writeList(KEY, list);
};

export const clearHistory = () => {
  localStorage.removeItem(KEY);
  notifyChange();
};

// --- New Storage for Full Invoice Data ---

export const getInvoiceData = (): InvoiceData[] => readList<InvoiceData>(DATA_KEY);

const invoiceKey = (item: InvoiceData) => `${item.fullNumber || item.invoiceNumber}|${item.date || ''}`;

/** 同一張發票（號碼＋日期）重複掃描時只保留最新一筆 */
export const saveInvoiceData = (item: InvoiceData): InvoiceData[] => {
  const key = invoiceKey(item);
  const list = getInvoiceData().filter(existing => invoiceKey(existing) !== key);
  const newList = [item, ...list].slice(0, INVOICE_DATA_LIMIT);
  writeList(DATA_KEY, newList);
  return newList;
};

export const clearInvoiceData = () => {
  localStorage.removeItem(DATA_KEY);
  notifyChange();
};
