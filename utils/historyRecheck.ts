import { HistoryItem, WinningNumbers } from '../types';
import { checkAgainstPeriods, checkInvoice, pickBestResult, resultLabel } from './checkLogic';
import { getClaimWindow, parsePeriod } from './period';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecheckOutcome {
  /** 更新後的完整歷史紀錄 */
  history: HistoryItem[];
  /** 結果有變動的紀錄 */
  changed: HistoryItem[];
  /** 有任何欄位更新（包含只補記已比對期別），需要寫回儲存 */
  dirty: boolean;
}

const checkedPeriodsOf = (item: HistoryItem): string[] =>
  item.checkedPeriods ?? (item.result.period ? [item.result.period] : []);

/**
 * 獎號更新後重新對獎一筆歷史紀錄。
 *
 * - 掃描時有發票日期、但當時該期尚未開獎（期別不明）：開獎後改用該期獎號對獎。
 * - 沒有發票日期（手動輸入）：發票在輸入當下就已存在，所以屬於「開始日不晚於輸入時間」的期別。
 *   當時還沒開獎、現在已有獎號的這些期別，補比對一次，取最好的結果。
 * - Gmail 掃描的紀錄在掃描時已依日期確定期別，不重新對獎。
 */
export const recheckHistoryItem = (item: HistoryItem, list: WinningNumbers[], now = Date.now()): { item: HistoryItem; changed: boolean } => {
  if (item.source === 'gmail' || list.length === 0) return { item, changed: false };

  if (item.invoiceDate) {
    if (!item.result.periodUnknown) return { item, changed: false };
    const [result] = checkAgainstPeriods(item.number, list, 0, item.invoiceDate);
    if (!result || result.periodUnknown) return { item, changed: false };
    return {
      item: { ...item, result, checkedPeriods: result.period ? [result.period] : [], recheckedAt: now },
      changed: true,
    };
  }

  const checked = checkedPeriodsOf(item);
  const pending = list.filter(winning => {
    if (checked.includes(winning.period)) return false;
    const range = parsePeriod(winning.period);
    const claim = getClaimWindow(winning.period);
    // 期別在輸入前就開始，且輸入時尚未開獎（開獎日當天結束前都算尚未公布）
    return Boolean(range && claim && range.start.getTime() <= item.timestamp && item.timestamp < claim.drawDate.getTime() + DAY_MS);
  });
  if (pending.length === 0) return { item, changed: false };

  const newResults = pending.map(winning => checkInvoice(item.number, winning, list.indexOf(winning) === 0));
  // 結果相同時保留原本的結果（原結果排在前面）
  const best = pickBestResult([item.result, ...newResults])!;
  const changed = best !== item.result && resultLabel(best) !== resultLabel(item.result);
  return {
    item: {
      ...item,
      result: best,
      checkedPeriods: [...checked, ...pending.map(winning => winning.period)],
      ...(changed ? { recheckedAt: now } : {}),
    },
    changed,
  };
};

export const recheckHistory = (history: HistoryItem[], list: WinningNumbers[], now = Date.now()): RecheckOutcome => {
  const changed: HistoryItem[] = [];
  let dirty = false;
  const updated = history.map(item => {
    const outcome = recheckHistoryItem(item, list, now);
    if (outcome.item !== item) dirty = true;
    if (outcome.changed) changed.push(outcome.item);
    return outcome.item;
  });
  return { history: updated, changed, dirty };
};
