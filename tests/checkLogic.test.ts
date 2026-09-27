import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { checkInvoice } from '../utils/checkLogic';
import { PrizeType, WinningNumbers } from '../types';

/**
 * 對獎邏輯測試：以 6 期財政部真實開獎號碼（固定快照，不隨每日更新變動），
 * 將 checkInvoice 的結果與依官方給獎規則獨立實作的 oracle 比對。
 *
 * 執行：npm test
 */

// --- 解析財政部官方 RSS 快照（真實開獎號碼） ---
const xml = readFileSync(fileURLToPath(new URL('./fixtures/invoice-6-periods.xml', import.meta.url)), 'utf8');
const periods: WinningNumbers[] = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
  const item = m[1];
  const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)![1];
  const desc = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)![1].replace(/<[^>]+>/g, ' ');
  const get = (label: string) =>
    (desc.match(new RegExp(label + '：([0-9、]+)')) || [, ''])[1]!.split('、').filter(Boolean);
  return {
    period: title,
    specialPrize: get('特別獎')[0],
    grandPrize: get('特獎')[0],
    firstPrize: get('頭獎'),
    additionalSixthPrize: get('增開六獎'),
  };
});

// --- 依官方給獎規則獨立實作的 oracle ---
// 與頭獎末 k 碼相同：k=8 頭獎、7 二獎、6 三獎、5 四獎、4 五獎、3 六獎
const tiers = [PrizeType.Sixth, PrizeType.Fifth, PrizeType.Fourth, PrizeType.Third, PrizeType.Second, PrizeType.First];
const amounts: Record<PrizeType, number> = {
  [PrizeType.Special]: 10_000_000,
  [PrizeType.Grand]: 2_000_000,
  [PrizeType.First]: 200_000,
  [PrizeType.Second]: 40_000,
  [PrizeType.Third]: 10_000,
  [PrizeType.Fourth]: 4_000,
  [PrizeType.Fifth]: 1_000,
  [PrizeType.Sixth]: 200,
  [PrizeType.None]: 0,
};
const suffixLen = (a: string, b: string) => {
  let k = 0;
  while (k < Math.min(a.length, b.length) && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k;
};
const oracle = (n: string, w: WinningNumbers): PrizeType => {
  if (n === w.specialPrize) return PrizeType.Special;
  if (n === w.grandPrize) return PrizeType.Grand;
  const best = Math.max(...w.firstPrize.map((f) => suffixLen(n, f)));
  if (best >= 3) return tiers[best - 3];
  if (w.additionalSixthPrize.some((a) => n.endsWith(a))) return PrizeType.Sixth;
  return PrizeType.None;
};

type Case = { label: string; n: string; w: WinningNumbers; want: PrizeType; partial?: boolean };

// 把 checkInvoice 的結果和期望值比對，回傳不符合的案例（最多列 20 筆方便除錯）
const runCases = (cases: Case[]) => {
  const fails: string[] = [];
  for (const { label, n, w, want, partial } of cases) {
    const r = checkInvoice(n, w, true);
    const ok =
      r.prizeType === want &&
      (partial ? r.isPartial === true : (r.amount ?? 0) === amounts[want] && !r.isPartial);
    if (!ok && fails.length < 20) fails.push(`${w.period} ${label} ${n}: got ${r.prizeType}/${r.amount}/${r.isPartial}, want ${want}`);
  }
  return fails;
};

const flip = (d: string) => String((Number(d) + 5) % 10);

describe('checkInvoice（6 期真實開獎號碼）', () => {
  test('快照包含 6 期完整獎號', () => {
    expect(periods).toHaveLength(6);
    for (const w of periods) {
      expect(w.specialPrize).toMatch(/^\d{8}$/);
      expect(w.grandPrize).toMatch(/^\d{8}$/);
      expect(w.firstPrize).toHaveLength(3);
    }
  });

  test('特別獎、特獎完整 8 碼（12 組）', () => {
    const cases = periods.flatMap((w) => [
      { label: '特別獎', n: w.specialPrize, w, want: PrizeType.Special },
      { label: '特獎', n: w.grandPrize, w, want: PrizeType.Grand },
    ]);
    expect(cases).toHaveLength(12);
    expect(runCases(cases)).toEqual([]);
  });

  test('頭獎～六獎邊界：與頭獎末 k 碼相同、第 k+1 碼不同（108 組）', () => {
    const cases = periods.flatMap((w) =>
      w.firstPrize.flatMap((f) =>
        [8, 7, 6, 5, 4, 3].map((k) => {
          const n = k === 8 ? f : f.slice(0, 8 - k - 1) + flip(f[8 - k - 1]) + f.slice(8 - k);
          return { label: `頭獎末 ${k} 碼`, n, w, want: oracle(n, w) };
        }),
      ),
    );
    expect(cases).toHaveLength(108);
    expect(runCases(cases)).toEqual([]);
  });

  test('只和特別獎／特獎末 7 碼相同不得獎（12 組）', () => {
    const cases = periods.flatMap((w) =>
      [w.specialPrize, w.grandPrize].map((p) => {
        const n = flip(p[0]) + p.slice(1);
        return { label: '差 1 碼', n, w, want: oracle(n, w) };
      }),
    );
    expect(cases).toHaveLength(12);
    expect(runCases(cases)).toEqual([]);
  });

  test('末三碼 000–999 窮舉（6,000 組）', () => {
    const cases: Case[] = periods.flatMap((w) =>
      Array.from({ length: 1000 }, (_, i) => {
        const n = String(i).padStart(3, '0');
        // 只輸入末三碼時：與特別獎／特獎末碼相同要提示核對 8 碼，與頭獎／增開六獎末三碼相同為六獎
        if (w.specialPrize.endsWith(n)) return { label: '末三碼', n, w, want: PrizeType.Special, partial: true };
        if (w.grandPrize.endsWith(n)) return { label: '末三碼', n, w, want: PrizeType.Grand, partial: true };
        if (w.firstPrize.some((f) => f.endsWith(n)) || w.additionalSixthPrize.includes(n))
          return { label: '末三碼', n, w, want: PrizeType.Sixth };
        return { label: '末三碼', n, w, want: PrizeType.None };
      }),
    );
    expect(cases).toHaveLength(6000);
    expect(runCases(cases)).toEqual([]);
  });

  test('隨機 8 碼號碼與 oracle 交叉比對（18,000 組，固定亂數種子）', () => {
    let seed = 20260926;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const cases = periods.flatMap((w) =>
      Array.from({ length: 3000 }, () => {
        const n = String(Math.floor(rnd() * 1e8)).padStart(8, '0');
        return { label: '隨機', n, w, want: oracle(n, w) };
      }),
    );
    expect(cases).toHaveLength(18000);
    expect(runCases(cases)).toEqual([]);
  });
});
