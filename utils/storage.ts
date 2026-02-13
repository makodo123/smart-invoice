import { HistoryItem, InvoiceData } from '../types';

const KEY = 'invoice_history';
const DATA_KEY = 'smart_invoice_data';

export const getHistory = (): HistoryItem[] => {
  try {
    const item = localStorage.getItem(KEY);
    return item ? JSON.parse(item) : [];
  } catch {
    return [];
  }
};

export const saveHistoryItem = (item: HistoryItem): HistoryItem[] => {
  const history = getHistory();
  // Add new item to the beginning, limit to 50 items
  const newHistory = [item, ...history].slice(0, 50);
  saveHistoryList(newHistory);
  return newHistory;
};

export const saveHistoryList = (list: HistoryItem[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Failed to save history", e);
  }
};

export const clearHistory = () => {
  localStorage.removeItem(KEY);
};

// --- New Storage for Full Invoice Data ---

export const getInvoiceData = (): InvoiceData[] => {
  try {
    const item = localStorage.getItem(DATA_KEY);
    return item ? JSON.parse(item) : [];
  } catch {
    return [];
  }
};

export const saveInvoiceData = (item: InvoiceData): InvoiceData[] => {
  const list = getInvoiceData();
  const newList = [item, ...list].slice(0, 100); // Limit to 100 full records
  localStorage.setItem(DATA_KEY, JSON.stringify(newList));
  return newList;
};

export const clearInvoiceData = () => {
  localStorage.removeItem(DATA_KEY);
};
