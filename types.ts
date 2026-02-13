export interface WinningNumbers {
  period: string; // e.g., "112年 09-10月"
  specialPrize: string; // 特別獎 (1000萬)
  grandPrize: string; // 特獎 (200萬)
  firstPrize: string[]; // 頭獎 (20萬) - usually 3 sets
  additionalSixthPrize: string[]; // 增開六獎 (200元)
}

export enum PrizeType {
  Special = '特別獎 (1000萬)',
  Grand = '特獎 (200萬)',
  First = '頭獎 (20萬)',
  Second = '二獎 (4萬)',
  Third = '三獎 (1萬)',
  Fourth = '四獎 (4000)',
  Fifth = '五獎 (1000)',
  Sixth = '六獎 (200)',
  None = '未中獎'
}

export interface CheckResult {
  isMatch: boolean;
  prizeType: PrizeType;
  amount?: number;
  matchedNumber?: string;
  description?: string;
  period?: string; // which period matched
  isCurrentPeriod?: boolean; // useful for UI highlighting
  isPartial?: boolean; // if true, it means it matches suffix of Special/Grand but needs full check
}

export interface HistoryItem {
  id: string;
  number: string;
  timestamp: number;
  result: CheckResult;
}

export interface InvoiceData {
  invoiceNumber: string;
  date: string; // YYYY/MM/DD
  amount: number;
  storeName?: string;
  details?: string; // Optional raw details
}
