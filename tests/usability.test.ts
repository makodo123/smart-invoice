import { beforeEach, describe, expect, test } from 'vitest';
import { checkAgainstPeriods, checkInvoice, pickBestResult, resultLabel } from '../utils/checkLogic';
import {
  findCandidatePeriodIndexes, findPeriodIndexForDate, getClaimWindow, getComparePeriods, isClaimExpired, parseInvoiceDate,
} from '../utils/period';
import { parseTaiwanInvoiceQR } from '../utils/qrScanner';
import { extractInvoiceDateFromText } from '../services/gmail';
import { buildInvoiceCSV } from '../utils/export';
import { PrizeType, WinningNumbers } from '../types';

const JUL_AUG: WinningNumbers = {
  period: '115年 07~08月',
  specialPrize: '89996565',
  grandPrize: '91098182',
  firstPrize: ['54348835', '44991397', '06595111'],
  additionalSixthPrize: [],
};
const MAY_JUN: WinningNumbers = {
  period: '115年 05~06月',
  specialPrize: '38548029',
  grandPrize: '10138845',
  firstPrize: ['24121106', '28589937', '83663333'],
  additionalSixthPrize: [],
};
const MAR_APR: WinningNumbers = {
  period: '115年 03~04月',
  specialPrize: '19531471',
  grandPrize: '85941329',
  firstPrize: ['07225810', '20231230', '83518781'],
  additionalSixthPrize: [],
};
const LIST = [JUL_AUG, MAY_JUN, MAR_APR];

describe('部分號碼對獎', () => {
  test('只輸入末 3 碼且與頭獎相同：至少六獎，提示輸入完整號碼', () => {
    const r = checkInvoice('835', JUL_AUG);
    expect(r.prizeType).toBe(PrizeType.Sixth);
    expect(r.amount).toBe(200);
    expect(r.mayBeHigher).toBe(true);
    expect(resultLabel(r)).toBe('至少六獎');
  });

  test('輸入 5 碼全部相同：至少四獎；第 5 碼不同則確定為五獎', () => {
    expect(checkInvoice('48835', JUL_AUG)).toMatchObject({ prizeType: PrizeType.Fourth, mayBeHigher: true });
    expect(checkInvoice('18835', JUL_AUG)).toMatchObject({ prizeType: PrizeType.Fifth, mayBeHigher: false });
  });

  test('完整 8 碼不會標示可能更高', () => {
    expect(checkInvoice('54348835', JUL_AUG)).toMatchObject({ prizeType: PrizeType.First, mayBeHigher: false });
  });

  test('與特別獎末碼相同時，同時說明已確定的頭獎末碼獎項', () => {
    const w: WinningNumbers = { ...JUL_AUG, specialPrize: '12345835' };
    const r = checkInvoice('835', w);
    expect(r).toMatchObject({ prizeType: PrizeType.Special, isPartial: true });
    expect(r.description).toContain('至少六獎');
  });
});

describe('依期別對獎', () => {
  test('有發票日期時只比對該期，不會拿其他期的獎號判中獎', () => {
    // 54348835 是 7–8 月頭獎；5 月的發票不能因此中獎
    const may = checkAgainstPeriods('54348835', LIST, 0, '2026/05/20');
    expect(may).toHaveLength(1);
    expect(may[0]).toMatchObject({ period: MAY_JUN.period, isMatch: false });

    const jul = checkAgainstPeriods('54348835', LIST, 0, '2026/07/02');
    expect(jul[0]).toMatchObject({ period: JUL_AUG.period, prizeType: PrizeType.First });
  });

  test('發票期別尚未開獎時標示期別不明', () => {
    const r = checkAgainstPeriods('54348835', LIST, 0, '2026/09/10');
    expect(r[0]).toMatchObject({ isMatch: false, periodUnknown: true });
    expect(r[0].description).toContain('尚未開獎');
  });

  test('手動輸入比對選取的期別與前一期，各自回傳結果', () => {
    expect(checkAgainstPeriods('835', LIST, 0).map(r => r.period)).toEqual([JUL_AUG.period, MAY_JUN.period]);
    expect(checkAgainstPeriods('835', LIST, 2).map(r => r.period)).toEqual([MAR_APR.period]);
    expect(getComparePeriods(LIST, 1)).toEqual([MAY_JUN, MAR_APR]);
  });

  test('pickBestResult：確定中獎優先於疑似中獎與未中獎', () => {
    const none = checkInvoice('000', MAY_JUN);
    const partial = checkInvoice('565', JUL_AUG);
    const sixth = checkInvoice('333', MAY_JUN);
    expect(pickBestResult([none, partial, sixth])).toBe(sixth);
    expect(pickBestResult([none, partial])).toBe(partial);
  });

  test('收信日在期別交界時兩期都列入候選', () => {
    const jul2 = new Date(2026, 6, 2, 10).getTime();
    expect(findCandidatePeriodIndexes(jul2, LIST)).toEqual([0, 1]);
    const jul10 = new Date(2026, 6, 10).getTime();
    expect(findCandidatePeriodIndexes(jul10, LIST)).toEqual([0]);
  });

  test('解析發票日期（西元、民國、中文）', () => {
    expect(parseInvoiceDate('2026/06/30')?.getMonth()).toBe(5);
    expect(parseInvoiceDate('115/07/01')?.getFullYear()).toBe(2026);
    expect(parseInvoiceDate('2026年7月1日')?.getDate()).toBe(1);
    expect(parseInvoiceDate('2026/02/30')).toBeNull();
    expect(findPeriodIndexForDate(new Date(2026, 7, 31), LIST)).toBe(0);
  });
});

describe('領獎期限', () => {
  test('7–8 月期：9/25 開獎，10/6 至隔年 1/5 領獎', () => {
    const w = getClaimWindow(JUL_AUG.period)!;
    expect([w.drawDate.getMonth(), w.drawDate.getDate()]).toEqual([8, 25]);
    expect([w.claimStart.getMonth(), w.claimStart.getDate()]).toEqual([9, 6]);
    expect([w.claimEnd.getFullYear(), w.claimEnd.getMonth(), w.claimEnd.getDate()]).toEqual([2027, 0, 5]);
  });

  test('11–12 月期跨年', () => {
    const w = getClaimWindow('114年 11~12月')!;
    expect([w.claimStart.getFullYear(), w.claimStart.getMonth(), w.claimStart.getDate()]).toEqual([2026, 1, 6]);
    expect([w.claimEnd.getMonth(), w.claimEnd.getDate()]).toEqual([4, 5]);
  });

  test('過期判斷', () => {
    expect(isClaimExpired(MAR_APR.period, new Date(2026, 9, 25))).toBe(true);
    expect(isClaimExpired(JUL_AUG.period, new Date(2026, 9, 25))).toBe(false);
  });
});

describe('QR Code 與 Gmail 解析', () => {
  test('左側 QR Code 解析出字軌、日期、金額與賣方統編', () => {
    const qr = 'AB12345678' + '1150705' + '1234' + '00000064' + '0000006E' + '00000000' + '24549210' + 'x'.repeat(24);
    const parsed = parseTaiwanInvoiceQR(qr)!.data!;
    expect(parsed).toMatchObject({ invoiceNumber: '12345678', fullNumber: 'AB12345678', date: '2026/07/05', amount: 110, sellerId: '24549210' });
  });

  test('從信件內文找出發票日期', () => {
    expect(extractInvoiceDateFromText('發票號碼：AB-12345678 發票日期：2026/06/30')).toBe('2026/06/30');
    expect(extractInvoiceDateFromText('開立日期 115年07月01日')).toBe('2026/07/01');
    expect(extractInvoiceDateFromText('寄件日期 2026/07/01')).toBeUndefined();
  });

  test('沒有日期標示時，讀取緊接在發票號碼後的日期（momo 格式）', () => {
    expect(extractInvoiceDateFromText('115年 09-10月 EQ-32140849 2026-10-19 23:59:59 隨機碼：0009')).toBe('2026/10/19');
    // 有標示的日期優先
    expect(extractInvoiceDateFromText('AB12345678 2026-10-19 發票日期：2026/10/20')).toBe('2026/10/20');
    // 號碼後面不是日期時不誤判
    expect(extractInvoiceDateFromText('發票號碼 FQ58392856 隨機碼 8591')).toBeUndefined();
    expect(extractInvoiceDateFromText('訂單 26101923260194 2026-10-19')).toBeUndefined();
  });
});

describe('匯出 CSV', () => {
  test('包含字軌號碼、統編、對獎期別與結果，並保留開頭的 0', () => {
    const csv = buildInvoiceCSV([{
      invoiceNumber: '06595111', fullNumber: 'AB06595111', date: '2026/07/05', amount: 110,
      sellerId: '04549210', period: JUL_AUG.period, prize: '頭獎', prizeAmount: 200000,
    }]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('發票號碼,日期,總金額,賣方統編,商家名稱,對獎期別,對獎結果,獎金');
    expect(row).toBe('="AB06595111",2026/07/05,110,="04549210",,115年 07~08月,頭獎,200000');
  });
});

describe('歷史紀錄儲存', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  const item = (number: string, timestamp: number, period = JUL_AUG.period) => ({
    id: `${number}-${timestamp}`, number, timestamp, result: { ...checkInvoice(number, JUL_AUG), period },
  });

  test('Gmail 加入的紀錄不會被之後的手動輸入覆蓋', async () => {
    const { addHistoryItems, upsertTypedHistoryItem, getHistory } = await import('../utils/storage');
    addHistoryItems([item('54348835', 1)]);
    upsertTypedHistoryItem(item('123', 100_000));
    expect(getHistory().map(h => h.number)).toEqual(['123', '54348835']);
  });

  test('打字修正（10 秒內補字或退格）只更新同一筆', async () => {
    const { upsertTypedHistoryItem, getHistory } = await import('../utils/storage');
    upsertTypedHistoryItem(item('123', 1_000));
    upsertTypedHistoryItem(item('1234', 2_000));
    upsertTypedHistoryItem(item('123', 3_000));
    upsertTypedHistoryItem(item('999', 30_000));
    expect(getHistory().map(h => h.number)).toEqual(['999', '123']);
  });

  test('同一張發票重複掃描只保留一筆記帳資料', async () => {
    const { saveInvoiceData, getInvoiceData } = await import('../utils/storage');
    saveInvoiceData({ invoiceNumber: '12345678', fullNumber: 'AB12345678', date: '2026/07/05', amount: 1 });
    saveInvoiceData({ invoiceNumber: '12345678', fullNumber: 'AB12345678', date: '2026/07/05', amount: 1 });
    expect(getInvoiceData()).toHaveLength(1);
  });
});

describe('新一期開獎後重新對獎歷史紀錄', async () => {
  const { recheckHistory } = await import('../utils/historyRecheck');
  const SEP_OCT: WinningNumbers = {
    period: '115年 09~10月',
    specialPrize: '11112222',
    grandPrize: '33334444',
    firstPrize: ['55556666', '77778888', '99990000'],
    additionalSixthPrize: [],
  };
  const NEW_LIST = [SEP_OCT, ...LIST];
  const oct1 = new Date(2026, 9, 1, 12).getTime();

  test('掃描時尚未開獎的發票，開獎後依發票日期重新對獎', () => {
    const [unknown] = checkAgainstPeriods('12346666', LIST, 0, '2026/09/10');
    const item = { id: '1', number: '12346666', timestamp: oct1, result: unknown, source: 'scan' as const, invoiceDate: '2026/09/10' };

    expect(recheckHistory([item], LIST).dirty).toBe(false);

    const { history, changed } = recheckHistory([item], NEW_LIST, 99);
    expect(changed).toHaveLength(1);
    expect(history[0].result).toMatchObject({ period: SEP_OCT.period, prizeType: PrizeType.Fifth, isMatch: true });
    expect(history[0].recheckedAt).toBe(99);
  });

  test('手動輸入時尚未開獎的期別，開獎後補比對', () => {
    const checks = checkAgainstPeriods('888', LIST, 0);
    const item = {
      id: '2', number: '888', timestamp: oct1, result: pickBestResult(checks)!, source: 'manual' as const,
      checkedPeriods: checks.map(r => r.period!),
    };
    expect(item.result.isMatch).toBe(false);

    const { history, changed } = recheckHistory([item], NEW_LIST);
    expect(changed).toHaveLength(1);
    expect(history[0].result).toMatchObject({ period: SEP_OCT.period, prizeType: PrizeType.Sixth, mayBeHigher: true });
    expect(history[0].checkedPeriods).toContain(SEP_OCT.period);

    // 再跑一次不會重複處理
    expect(recheckHistory(history, NEW_LIST).dirty).toBe(false);
  });

  test('輸入時期別還沒開始，或新結果一樣是未中獎，都不標示有新結果', () => {
    const aug1 = new Date(2026, 7, 1).getTime();
    const early = { id: '3', number: '888', timestamp: aug1, result: checkInvoice('888', JUL_AUG), source: 'manual' as const, checkedPeriods: [JUL_AUG.period] };
    expect(recheckHistory([early], NEW_LIST).dirty).toBe(false);

    const noWin = { id: '4', number: '123', timestamp: oct1, result: checkInvoice('123', JUL_AUG), source: 'manual' as const, checkedPeriods: [JUL_AUG.period] };
    const outcome = recheckHistory([noWin], NEW_LIST);
    expect(outcome.changed).toHaveLength(0);
    expect(outcome.history[0].result).toBe(noWin.result);
    expect(outcome.history[0].checkedPeriods).toContain(SEP_OCT.period);
  });

  test('Gmail 紀錄已依日期確定期別，不重新對獎', () => {
    const item = { id: '5', number: '55556666', timestamp: oct1, result: checkInvoice('55556666', JUL_AUG), source: 'gmail' as const };
    expect(recheckHistory([item], NEW_LIST).dirty).toBe(false);
  });
});
