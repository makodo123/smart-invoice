import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractInvoiceNumbersFromText, type InvoiceNumber } from './gmail.ts';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();

/** Read selectable text from a PDF in the browser. No PDF bytes are uploaded. */
export const extractInvoiceNumbersFromPdf = async (bytes: Uint8Array): Promise<InvoiceNumber[]> => {
  const task = getDocument({ data: bytes });
  const document = await task.promise;
  const invoices: InvoiceNumber[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pieces = content.items.filter(item => 'str' in item);
      let layoutText = '';
      let previousEnd = 0;
      let previousY: number | null = null;
      for (const item of pieces) {
        const x = item.transform[4];
        const y = item.transform[5];
        if (previousY !== null && (Math.abs(y - previousY) > 2 || x - previousEnd > 4)) layoutText += ' ';
        layoutText += item.str;
        if (item.hasEOL) layoutText += '\n';
        previousEnd = x + item.width;
        previousY = y;
      }
      invoices.push(...extractInvoiceNumbersFromText(layoutText));
      invoices.push(...extractInvoiceNumbersFromText(pieces.map(item => item.str).join(' ')));
    }
  } finally {
    await task.destroy();
  }
  return [...new Map(invoices.map(invoice => [invoice.fullNumber, invoice])).values()];
};
