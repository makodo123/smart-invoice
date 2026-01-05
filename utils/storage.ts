import { HistoryItem } from '../types';

const KEY = 'invoice_history';

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
