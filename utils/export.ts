import { InvoiceData } from '../types';

/**
 * Converts invoice data to CSV format and triggers download.
 */
export const exportToCSV = (data: InvoiceData[]) => {
  if (data.length === 0) return;

  // BOM for Excel to read UTF-8 correctly
  const BOM = "\uFEFF";
  
  const headers = ["發票號碼", "日期", "總金額", "商家名稱"];
  const csvContent = [
    headers.join(","),
    ...data.map(item => {
      const row = [
        item.invoiceNumber,
        item.date,
        item.amount,
        `"${(item.storeName || "").replace(/"/g, '""')}"` // Escape quotes
      ];
      return row.join(",");
    })
  ].join("\n");

  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `invoices_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
