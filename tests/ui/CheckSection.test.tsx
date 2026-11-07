// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import CheckSection from '../../components/CheckSection';
import { LIST } from './fixtures';

/** 輸入號碼（與使用者在輸入框打字相同，會觸發 onChange） */
const typeNumber = (value: string) => {
  fireEvent.change(screen.getByLabelText('發票號碼'), { target: { value } });
};

/** 等手動輸入停頓 1 秒後自動存入歷史紀錄 */
const waitForAutoSave = () => act(() => {
  vi.advanceTimersByTime(1100);
});

const renderSection = (selectedIndex = 0) => render(<CheckSection winningNumbersList={LIST} selectedIndex={selectedIndex} />);

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
  test('說明目前比對的兩期，輸入框提示末 3 碼或完整 8 碼', () => {
    renderSection();
    expect(screen.getByText(/輸入號碼會同時比對 115年 07~08月 和 115年 05~06月/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('輸入末 3 碼或完整 8 碼')).toBeInTheDocument();
  });

  test('只接受數字，最多 8 碼', () => {
    renderSection();
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

  test('切到已過期的期別：中獎時提醒超過領獎期限，不顯示領獎方式', () => {
    renderSection(2);
    typeNumber('07225810');
    expect(screen.getByText('🎉 恭喜中獎！')).toBeInTheDocument();
    expect(screen.getByText('⚠️ 此期已超過領獎期限')).toBeInTheDocument();
    expect(screen.queryByText('領獎方式')).not.toBeInTheDocument();
  });

  test('清除按鈕清空輸入與結果', () => {
    renderSection();
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
