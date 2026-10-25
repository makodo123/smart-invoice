import { WinningNumbers } from '../types';

export interface PeriodRange {
  /** 西元年 */
  year: number;
  startMonth: number;
  endMonth: number;
  /** 期別第一天 00:00 */
  start: Date;
  /** 期別最後一天 23:59:59.999 */
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 解析「115年 07~08月」「112年 09-10月」等期別字串 */
export const parsePeriod = (period: string): PeriodRange | null => {
  const match = period.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*[-~～－至]\s*(\d{1,2})\s*月/);
  if (!match) return null;
  const rawYear = Number(match[1]);
  const year = rawYear >= 1911 ? rawYear : rawYear + 1911;
  const startMonth = Number(match[2]);
  const endMonth = Number(match[3]);
  const start = new Date(year, startMonth - 1, 1);
  const end = new Date(year, endMonth, 0, 23, 59, 59, 999);
  return { year, startMonth, endMonth, start, end };
};

/**
 * 解析發票日期：支援 YYYY/MM/DD、民國 YYY/MM/DD、YYYY-MM-DD、YYYY年MM月DD日。
 * 無法解析時回傳 null。
 */
export const parseInvoiceDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const match = value.match(/(\d{3,4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
  if (!match) return null;
  const rawYear = Number(match[1]);
  const year = rawYear >= 1911 ? rawYear : rawYear + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

/** 找出發票日期所屬的期別（找不到回傳 -1） */
export const findPeriodIndexForDate = (date: Date, list: WinningNumbers[]): number =>
  list.findIndex(item => {
    const range = parsePeriod(item.period);
    return Boolean(range && date >= range.start && date <= range.end);
  });

/**
 * 依收信時間推測可能的期別。電子發票通知可能在期別結束後幾天才寄出，
 * 所以交界處（次月前 graceDays 天）會同時回傳前後兩期，由呼叫端兩期都比對。
 */
export const findCandidatePeriodIndexes = (timestamp: number, list: WinningNumbers[], graceDays = 3): number[] =>
  list.flatMap((item, index) => {
    const range = parsePeriod(item.period);
    if (!range) return [];
    return timestamp >= range.start.getTime() && timestamp <= range.end.getTime() + graceDays * DAY_MS ? [index] : [];
  });

/** 對獎期別：選取的期別與它的前一期 */
export const getComparePeriods = (list: WinningNumbers[], selectedIndex: number): WinningNumbers[] => {
  if (list.length === 0) return [];
  const start = Math.min(Math.max(selectedIndex, 0), list.length - 1);
  return list.slice(start, start + 2);
};

export interface ClaimWindow {
  /** 開獎日：期別結束後的次月 25 日 */
  drawDate: Date;
  /** 領獎期間：開獎次月 6 日起 */
  claimStart: Date;
  /** 領獎期間：至領獎起始日 3 個月後的 5 日 */
  claimEnd: Date;
}

/** 統一發票開獎日與領獎期間（每單月 25 日開獎，次月 6 日起領獎 3 個月） */
export const getClaimWindow = (period: string): ClaimWindow | null => {
  const range = parsePeriod(period);
  if (!range) return null;
  const { year, endMonth } = range;
  return {
    drawDate: new Date(year, endMonth, 25),
    claimStart: new Date(year, endMonth + 1, 6),
    claimEnd: new Date(year, endMonth + 4, 5, 23, 59, 59, 999),
  };
};

export const isClaimExpired = (period: string, now: Date = new Date()): boolean => {
  const window = getClaimWindow(period);
  return Boolean(window && now > window.claimEnd);
};

export const formatShortDate = (date: Date): string =>
  `${date.getFullYear() - 1911}/${date.getMonth() + 1}/${date.getDate()}`;
