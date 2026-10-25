import { WinningNumbers, PrizeType, CheckResult } from '../types';
import { findPeriodIndexForDate, getComparePeriods, parseInvoiceDate, parsePeriod } from './period';

const getPrizeAmount = (type: PrizeType): number => {
  switch (type) {
    case PrizeType.Special: return 10000000;
    case PrizeType.Grand: return 2000000;
    case PrizeType.First: return 200000;
    case PrizeType.Second: return 40000;
    case PrizeType.Third: return 10000;
    case PrizeType.Fourth: return 4000;
    case PrizeType.Fifth: return 1000;
    case PrizeType.Sixth: return 200;
    default: return 0;
  }
};

const PRIZE_NAME: Partial<Record<PrizeType, string>> = {
  [PrizeType.First]: '頭獎',
  [PrizeType.Second]: '二獎',
  [PrizeType.Third]: '三獎',
  [PrizeType.Fourth]: '四獎',
  [PrizeType.Fifth]: '五獎',
  [PrizeType.Sixth]: '六獎',
};

// 與頭獎末 k 碼相同：k=8 頭獎、7 二獎、6 三獎、5 四獎、4 五獎、3 六獎
const TIERS_BY_SUFFIX: Record<number, PrizeType> = {
  8: PrizeType.First,
  7: PrizeType.Second,
  6: PrizeType.Third,
  5: PrizeType.Fourth,
  4: PrizeType.Fifth,
  3: PrizeType.Sixth,
};

const suffixMatchLength = (a: string, b: string): number => {
  let count = 0;
  while (count < Math.min(a.length, b.length) && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
  return count;
};

type BaseResult = Pick<CheckResult, 'period' | 'isCurrentPeriod'>;

/** 頭獎～六獎與增開六獎 */
const checkFirstPrizeTiers = (num: string, winning: WinningNumbers, baseResult: BaseResult): CheckResult | null => {
  let bestFirst: string | null = null;
  let bestLength = 0;
  for (const first of winning.firstPrize) {
    const length = suffixMatchLength(num, first);
    if (length > bestLength) {
      bestLength = length;
      bestFirst = first;
    }
  }

  if (bestFirst && bestLength >= 3) {
    const prizeType = TIERS_BY_SUFFIX[bestLength];
    // 只輸入部分號碼且每一碼都相同時，完整號碼可能中更高獎項
    const mayBeHigher = num.length < 8 && bestLength === num.length;
    return {
      ...baseResult,
      isMatch: true,
      prizeType,
      amount: getPrizeAmount(prizeType),
      matchedNumber: bestFirst,
      mayBeHigher,
      description: mayBeHigher
        ? `與頭獎末 ${bestLength} 碼相同，至少${PRIZE_NAME[prizeType]}；請輸入完整 8 碼確認是否中更高獎項`
        : `與頭獎末 ${bestLength} 碼相同`,
    };
  }

  for (const add6 of winning.additionalSixthPrize || []) {
    if (num.endsWith(add6)) {
      return {
        ...baseResult,
        isMatch: true,
        prizeType: PrizeType.Sixth,
        amount: getPrizeAmount(PrizeType.Sixth),
        matchedNumber: add6,
        description: '增開六獎',
      };
    }
  }

  return null;
};

export const checkInvoice = (userNumber: string, winning: WinningNumbers, isCurrentPeriod: boolean = false): CheckResult => {
  const num = userNumber.trim();
  const baseResult: BaseResult = { period: winning.period, isCurrentPeriod };

  if (num.length < 3) {
    return { ...baseResult, isMatch: false, prizeType: PrizeType.None, amount: 0, description: "請輸入至少後 3 碼" };
  }

  const tierResult = checkFirstPrizeTiers(num, winning, baseResult);
  const guaranteedNote = tierResult ? `（已確定至少${PRIZE_NAME[tierResult.prizeType]} ${getPrizeAmount(tierResult.prizeType).toLocaleString()} 元）` : '';

  // 特別獎、特獎需 8 碼完全相同
  const fullPrizes: [string, PrizeType, string][] = [
    [winning.specialPrize, PrizeType.Special, '特別獎'],
    [winning.grandPrize, PrizeType.Grand, '特獎'],
  ];
  for (const [prizeNumber, prizeType, name] of fullPrizes) {
    if (prizeNumber === num) {
      return { ...baseResult, isMatch: true, prizeType, amount: getPrizeAmount(prizeType), matchedNumber: prizeNumber };
    }
    if (prizeNumber.endsWith(num)) {
      // 輸入不足 8 碼但與特別獎／特獎末碼相同，提醒核對完整號碼
      return {
        ...baseResult,
        isMatch: true,
        isPartial: true,
        prizeType,
        amount: 0,
        matchedNumber: prizeNumber,
        description: `與${name}末碼相同，請核對 8 碼${guaranteedNote}`,
      };
    }
  }

  return tierResult ?? { ...baseResult, isMatch: false, prizeType: PrizeType.None, amount: 0 };
};

const PRIZE_RANK: Record<PrizeType, number> = {
  [PrizeType.Special]: 0,
  [PrizeType.Grand]: 1,
  [PrizeType.First]: 2,
  [PrizeType.Second]: 3,
  [PrizeType.Third]: 4,
  [PrizeType.Fourth]: 5,
  [PrizeType.Fifth]: 6,
  [PrizeType.Sixth]: 7,
  [PrizeType.None]: 99,
};

/** 從多期結果中挑出最值得顯示的一筆：確定中獎 > 疑似中獎 > 未中獎 */
export const pickBestResult = (results: CheckResult[]): CheckResult | null => {
  if (results.length === 0) return null;
  const score = (result: CheckResult) => {
    if (!result.isMatch) return 1000;
    return (result.isPartial ? 100 : 0) + PRIZE_RANK[result.prizeType];
  };
  return results.reduce((best, current) => (score(current) < score(best) ? current : best));
};

/** 結果的簡短標籤（歷史紀錄、其他期別列表、連續掃描清單共用） */
export const resultLabel = (res: CheckResult): string => {
  if (res.periodUnknown) return '期別不明';
  if (!res.isMatch) return '未中獎';
  if (res.isPartial) return '核對全碼';
  const name = res.prizeType.split(' ')[0];
  return res.mayBeHigher ? `至少${name}` : name;
};

/**
 * 依期別對獎。有發票日期（掃描）時只比對該張發票所屬的期別；
 * 只有號碼（手動輸入）時比對選取的期別與前一期，並各自列出結果。
 */
export const checkAgainstPeriods = (
  num: string,
  winningNumbersList: WinningNumbers[],
  selectedIndex: number,
  invoiceDate?: string,
): CheckResult[] => {
  if (winningNumbersList.length === 0) return [];

  const date = parseInvoiceDate(invoiceDate);
  if (date) {
    const index = findPeriodIndexForDate(date, winningNumbersList);
    if (index >= 0) return [checkInvoice(num, winningNumbersList[index], index === 0)];

    const newest = parsePeriod(winningNumbersList[0].period);
    const notDrawnYet = Boolean(newest && date > newest.end);
    return [{
      isMatch: false,
      prizeType: PrizeType.None,
      amount: 0,
      periodUnknown: true,
      description: notDrawnYet
        ? `這張發票（${invoiceDate}）所屬期別尚未開獎，請於開獎後再對獎。`
        : `這張發票（${invoiceDate}）的期別不在目前的獎號資料中，可能已超過領獎期限。`,
    }];
  }

  return getComparePeriods(winningNumbersList, selectedIndex).map(winning =>
    checkInvoice(num, winning, winningNumbersList.indexOf(winning) === 0)
  );
};
