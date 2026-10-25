import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractInvoicesFromPdf } from '../services/pdfInvoices';

// 瀏覽器版由 Vite 打包 worker；Node 測試環境改指向套件內的檔案
GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

describe('PDF 附件', () => {
  test('有密碼的 PDF（例如電信、信用卡帳單）標示為略過，不當作讀取失敗', async () => {
    await expect(extractInvoicesFromPdf(fixture('password-protected.pdf'))).resolves.toEqual({ invoices: [], passwordProtected: true });
  });

  test('一般 PDF 正常讀取', async () => {
    const result = await extractInvoicesFromPdf(fixture('plain.pdf'));
    expect(result.passwordProtected).toBeUndefined();
    expect(result.invoices).toEqual([]);
  });
});
