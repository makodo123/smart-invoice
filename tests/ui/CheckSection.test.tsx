// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CheckSection from '../../components/CheckSection';
import { checkInvoice } from '../../utils/checkLogic';
import { LIST, MAY_JUN } from './fixtures';

/** 輸入號碼（與使用者在輸入框打字相同，會觸發 onChange） */
const typeNumber = (value: string) => {
  fireEvent.change(screen.getByLabelText('發票號碼'), { target: { value } });
};

/** 等手動輸入停頓 1 秒後自動存入歷史紀錄 */
const waitForAutoSave = () => act(() => {
  vi.advanceTimersByTime(1100);
});

const renderSection = (selectedIndex = 0) => render(<CheckSection winningNumbersList={LIST} selectedIndex={selectedIndex} />);

/** 關閉「連續對獎」，改成一般模式（號碼留在輸入框、照常累加） */
const useNormalMode = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: /連續對獎/ }));
};

beforeEach(() => {
  localStorage.clear();
  // 固定今天的日期，領獎期限的判斷才不會隨時間改變
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 12, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('快速對獎畫面', () => {
  test('說明目前比對的兩期；輸入框提示末 3 碼，一般模式提示末 3 碼或完整 8 碼', () => {
    renderSection();
    expect(screen.getByText(/輸入號碼會同時比對 115年 07~08月 和 115年 05~06月/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('輸入末 3 碼')).toBeInTheDocument();
    useNormalMode();
    expect(screen.getByPlaceholderText('輸入末 3 碼或完整 8 碼')).toBeInTheDocument();
  });

  test('只接受數字，最多 8 碼', () => {
    renderSection();
    useNormalMode();
    typeNumber('AB-1234567890');
    expect(screen.getByLabelText('發票號碼')).toHaveValue('12345678');
  });

  test('末 3 碼與特別獎相同：顯示疑似中獎，說明要 8 碼全部相同', () => {
    renderSection();
    typeNumber('565');
    expect(screen.getByText('⚠️ 疑似中獎')).toBeInTheDocument();
    expect(screen.getByText('對照：特別獎 (1000萬)')).toBeInTheDocument();
    expect(screen.getByText(/特別獎要 8 碼全部相同才中獎，目前只有末 3 碼相同/)).toBeInTheDocument();
    expect(screen.getByText('對照獎號：89996565')).toBeInTheDocument();
    // 疑似中獎不顯示領獎方式
    expect(screen.queryByText('領獎方式')).not.toBeInTheDocument();
  });

  test('末 3 碼與頭獎相同：顯示至少六獎，提示輸入完整號碼', () => {
    renderSection();
    useNormalMode();
    typeNumber('835');
    expect(screen.getByText('🎉 至少中六獎！')).toBeInTheDocument();
    expect(screen.getByText('輸入完整 8 碼，可確認是否中更高獎項')).toBeInTheDocument();
  });

  test('完整中頭獎：顯示預估實拿金額與領獎期間', () => {
    renderSection();
    typeNumber('54348835');
    expect(screen.getByText('🎉 恭喜中獎！')).toBeInTheDocument();
    expect(screen.getByText('頭獎 (20萬)')).toBeInTheDocument();
    expect(screen.getByText('159,200')).toBeInTheDocument();
    expect(screen.getByText(/領獎期間：115\/10\/6 ～ 116\/1\/5/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /領獎地點與規定請看財政部說明/ })).toHaveAttribute('href', 'https://invoice.etax.nat.gov.tw/');
    // 另一期的結果也列出來
    expect(screen.getByText('115年 05~06月')).toBeInTheDocument();
  });

  test('兩期都沒中：說明兩期皆未中獎', () => {
    renderSection();
    typeNumber('000');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
    expect(screen.getByText('115年 07~08月、115年 05~06月 皆未中獎')).toBeInTheDocument();
  });

  test('切到已過期的期別：中獎時改成灰色的「已過領獎期限」，說明截止日，不顯示領獎方式', () => {
    renderSection(2);
    typeNumber('07225810');
    expect(screen.getByText('⌛ 已過領獎期限')).toBeInTheDocument();
    expect(screen.queryByText('🎉 恭喜中獎！')).not.toBeInTheDocument();
    expect(screen.getByText('對照：頭獎 (20萬)')).toBeInTheDocument();
    expect(screen.getByText(/這期的領獎期限到 115\/9\/5 為止，已經不能領獎/)).toBeInTheDocument();
    expect(screen.queryByText('領獎方式')).not.toBeInTheDocument();
  });

  test('清除按鈕清空輸入與結果', () => {
    renderSection();
    useNormalMode();
    typeNumber('835');
    fireEvent.click(screen.getByRole('button', { name: '清除輸入' }));
    expect(screen.getByLabelText('發票號碼')).toHaveValue('');
    expect(screen.queryByText('🎉 至少中六獎！')).not.toBeInTheDocument();
  });

  test('上傳照片按鈕有文字標示', () => {
    renderSection();
    expect(screen.getByRole('button', { name: /上傳照片/ })).toBeInTheDocument();
  });
});

describe('歷史紀錄', () => {
  const historyRows = () => screen.getAllByRole('button', { name: /這筆紀錄$/ }).map((button) => button.closest('div.flex.justify-between') as HTMLElement);

  const addEntries = (...numbers: string[]) => {
    for (const number of numbers) {
      typeNumber(number);
      waitForAutoSave();
      // 間隔超過 10 秒，才會存成不同筆（10 秒內的補字或退格會合併）
      act(() => {
        vi.advanceTimersByTime(11_000);
      });
    }
  };

  test('輸入停頓後自動存入，顯示日期、期別與結果', () => {
    renderSection();
    addEntries('54348835');
    const [row] = historyRows();
    expect(within(row).getByText('54348835')).toBeInTheDocument();
    expect(within(row).getByText('10/29 12:00')).toBeInTheDocument();
    expect(within(row).getByText('· 115年 07~08月')).toBeInTheDocument();
    expect(within(row).getByText('頭獎')).toBeInTheDocument();
  });

  test('只看中獎：隱藏未中獎的紀錄', () => {
    renderSection();
    addEntries('000', '54348835');
    expect(historyRows()).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('只看中獎'));
    expect(historyRows()).toHaveLength(1);
    expect(within(historyRows()[0]).getByText('54348835')).toBeInTheDocument();
  });

  test('刪除單筆紀錄', () => {
    renderSection();
    addEntries('000', '54348835');
    fireEvent.click(screen.getByRole('button', { name: '刪除 000 這筆紀錄' }));
    expect(historyRows()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '刪除 000 這筆紀錄' })).not.toBeInTheDocument();
  });

  test('清除全部要按兩次確認，取消則保留', () => {
    renderSection();
    addEntries('000');
    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(historyRows()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '清除全部' }));
    fireEvent.click(screen.getByRole('button', { name: '確定清除所有紀錄與掃描的發票？' }));
    expect(screen.queryByText('歷史紀錄')).not.toBeInTheDocument();
  });
});

describe('連續對獎（預設開啟）', () => {
  const quickCheckbox = () => screen.getByRole('checkbox', { name: /連續對獎/ });
  const input = () => screen.getByLabelText('發票號碼');
  /** 輸入框下方的精簡結果 */
  const caption = () => screen.getByText((_, element) => element?.tagName === 'P' && /^(末 3 碼|號碼) \d+：/.test(element.textContent ?? ''));
  const historyButton = (number: string) => screen.queryByRole('button', { name: `刪除 ${number} 這筆紀錄` });
  const pendingPrompt = () => screen.queryByText(/對中了！請輸入這張發票的/);

  test('預設開啟，提示輸入末 3 碼', () => {
    renderSection();
    expect(quickCheckbox()).toBeChecked();
    expect(input()).toHaveAttribute('placeholder', '輸入末 3 碼');
  });

  test('末 3 碼沒中：馬上記錄並清空，直接打下一張', () => {
    renderSection();
    typeNumber('123');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
    expect(caption()).toHaveTextContent('末 3 碼 123：未中獎・已記錄');
    expect(input()).toHaveValue('');
    expect(historyButton('123')).toBeInTheDocument();
    expect(pendingPrompt()).not.toBeInTheDocument();

    // 打下一張的途中保留上一張的結果
    typeNumber('9');
    expect(input()).toHaveValue('9');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
  });

  test('末 3 碼對中：請輸入完整 8 碼，確認後以完整號碼取代末 3 碼的紀錄', () => {
    renderSection();
    typeNumber('835');
    expect(screen.getByText('🎉 至少中六獎！')).toBeInTheDocument();
    expect(pendingPrompt()).toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute('placeholder', '輸入完整 8 碼');
    // 卡片不再重複「輸入完整 8 碼」那句
    expect(screen.queryByText('輸入完整 8 碼，可確認是否中更高獎項')).not.toBeInTheDocument();
    expect(historyButton('835')).toBeInTheDocument();

    // 打到一半不會被當成下一張的末 3 碼
    typeNumber('543');
    expect(input()).toHaveValue('543');
    expect(pendingPrompt()).toBeInTheDocument();

    typeNumber('54348835');
    expect(screen.getByText('🎉 恭喜中獎！')).toBeInTheDocument();
    expect(screen.getByText('頭獎 (20萬)')).toBeInTheDocument();
    expect(caption()).toHaveTextContent('號碼 54348835：頭獎・已記錄');
    expect(pendingPrompt()).not.toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(historyButton('54348835')).toBeInTheDocument();
    expect(historyButton('835')).not.toBeInTheDocument();

    // 回到輸入末 3 碼
    expect(input()).toHaveAttribute('placeholder', '輸入末 3 碼');
    typeNumber('123');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
  });

  test('末 3 碼與特別獎相同也要輸入完整號碼確認', () => {
    renderSection();
    typeNumber('565');
    expect(screen.getByText('⚠️ 疑似中獎')).toBeInTheDocument();
    expect(pendingPrompt()).toBeInTheDocument();
    typeNumber('12345565');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
    expect(historyButton('12345565')).toBeInTheDocument();
    expect(historyButton('565')).not.toBeInTheDocument();
  });

  test('完整號碼的末 3 碼和剛才不同：提醒可能打錯，仍以完整號碼記錄', () => {
    renderSection();
    typeNumber('835');
    typeNumber('12345678');
    expect(screen.getByRole('alert')).toHaveTextContent('完整號碼 12345678 的末 3 碼是 678，和剛才輸入的 835 不同');
    expect(historyButton('12345678')).toBeInTheDocument();
    expect(historyButton('835')).not.toBeInTheDocument();
  });

  test('末 3 碼只和已過領獎期限的期別相同：不要求輸入完整號碼，直接打下一張', () => {
    vi.setSystemTime(new Date(2026, 10, 10, 12, 0));
    renderSection();
    typeNumber('106');
    expect(pendingPrompt()).not.toBeInTheDocument();
    expect(caption()).toHaveTextContent('末 3 碼 106：只和已過領獎期限的 115年 05~06月 相同・已記錄');
    expect(screen.getByText('⌛ 已過領獎期限')).toBeInTheDocument();
    expect(input()).toHaveAttribute('placeholder', '輸入末 3 碼');
    expect(screen.getByText('至少六獎（已過期）')).toBeInTheDocument();
  });

  test('先略過：保留末 3 碼的紀錄，繼續下一張', () => {
    renderSection();
    typeNumber('835');
    fireEvent.click(screen.getByRole('button', { name: '先略過' }));
    expect(pendingPrompt()).not.toBeInTheDocument();
    expect(historyButton('835')).toBeInTheDocument();
    expect(screen.getByText('至少六獎')).toBeInTheDocument();
    typeNumber('123');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
    expect(historyButton('123')).toBeInTheDocument();
  });

  test('貼上完整號碼：直接對完整號碼並記錄', () => {
    renderSection();
    typeNumber('54348835');
    expect(screen.getByText('頭獎 (20萬)')).toBeInTheDocument();
    expect(historyButton('54348835')).toBeInTheDocument();
    expect(pendingPrompt()).not.toBeInTheDocument();
  });

  test('關閉後是一般模式：號碼留在輸入框照常累加', () => {
    renderSection();
    useNormalMode();
    expect(quickCheckbox()).not.toBeChecked();
    typeNumber('835');
    typeNumber('8351');
    expect(input()).toHaveValue('8351');
    expect(pendingPrompt()).not.toBeInTheDocument();
  });

  test('關閉的設定會記住', () => {
    renderSection();
    useNormalMode();
    cleanup();
    renderSection();
    expect(quickCheckbox()).not.toBeChecked();
  });
});

describe('尚未開獎的下一期', () => {
  test('顯示下一期的開獎日，沒中獎時提醒該期發票要等開獎', () => {
    renderSection();
    expect(screen.getByText('下一期 115年 09~10月 將於 11/25 開獎。')).toBeInTheDocument();
    typeNumber('12345678');
    expect(screen.getByText('😔 沒中獎')).toBeInTheDocument();
    expect(screen.getByText(/9–10 月的發票請等 11\/25 開獎後再對/)).toBeInTheDocument();
  });

  test('開獎當天：說明號碼通常下午公布，不叫人馬上按更新，並繼續提醒該期發票要等開獎', () => {
    vi.setSystemTime(new Date(2026, 10, 25, 10, 0));
    renderSection();
    expect(screen.getByText(/今天（11\/25）是 115年 09~10月 開獎日，號碼通常下午公布/)).toBeInTheDocument();
    expect(screen.queryByText(/請按下方「更新號碼」/)).not.toBeInTheDocument();
    typeNumber('12345678');
    expect(screen.getByText(/9–10 月的發票請等 11\/25 開獎後再對/)).toBeInTheDocument();
  });

  test('開獎日已過但還沒更新獎號：提示按更新號碼', () => {
    vi.setSystemTime(new Date(2026, 10, 26, 9, 0));
    renderSection();
    expect(screen.getByText('115年 09~10月 已於 11/25 開獎，請按下方「更新號碼」取得最新獎號。')).toBeInTheDocument();
  });
});

describe('已過領獎期限', () => {
  test('比對說明標出已截止的期別', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0));
    renderSection();
    expect(screen.getByText(/115年 07~08月 和 115年 05~06月（已過領獎期限）/)).toBeInTheDocument();
  });

  test('歷史紀錄中已過期的中獎標示「已過期」', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0));
    const win = checkInvoice('24121106', MAY_JUN);
    localStorage.setItem('invoice_history', JSON.stringify([
      { id: 'old', number: '24121106', timestamp: new Date(2026, 6, 1).getTime(), result: win, source: 'gmail' },
    ]));
    renderSection();
    expect(screen.getByText('頭獎（已過期）')).toBeInTheDocument();
  });
});

describe('獎號載入中', () => {
  test('還沒有獎號時說明正在載入，輸入框與按鈕都停用', () => {
    render(<CheckSection winningNumbersList={[]} selectedIndex={0} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在載入中獎號碼');
    expect(screen.getByLabelText('發票號碼')).toBeDisabled();
    expect(screen.getByRole('button', { name: /掃描 QR Code/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /上傳照片/ })).toBeDisabled();
  });

  test('載入完成後不再顯示', () => {
    renderSection();
    expect(screen.queryByText(/正在載入中獎號碼/)).not.toBeInTheDocument();
  });
});
