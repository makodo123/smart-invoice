import { InvoiceData } from '../types';

const csvCell = (value: string | number | undefined | null) => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// 以 ="..." 包住數字字串，避免 Excel 把開頭的 0 去掉
const textCell = (value: string) => `="${value.replace(/"/g, '')}"`;

/** 產生 CSV 內容（不含 BOM） */
export const buildInvoiceCSV = (data: InvoiceData[]): string => {
  const headers = ["發票號碼", "日期", "總金額", "賣方統編", "商家名稱", "對獎期別", "對獎結果", "獎金"];
  return [
    headers.join(","),
    ...data.map(item => [
      textCell(item.fullNumber || item.invoiceNumber),
      csvCell(item.date),
      csvCell(item.amount || ''),
      item.sellerId ? textCell(item.sellerId) : '',
      csvCell(item.storeName),
      csvCell(item.period),
      csvCell(item.prize),
      csvCell(item.prizeAmount),
    ].join(","))
  ].join("\n");
};

/**
 * Converts invoice data to CSV format and triggers download.
 */
export const exportToCSV = (data: InvoiceData[]) => {
  if (data.length === 0) return;

  // BOM for Excel to read UTF-8 correctly
  const BOM = "﻿";
  const blob = new Blob([BOM + buildInvoiceCSV(data)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `invoices_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
