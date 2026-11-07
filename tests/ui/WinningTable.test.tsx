// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import WinningTable from '../../components/WinningTable';
import { LIST } from './fixtures';

const renderTable = (props: Partial<ComponentProps<typeof WinningTable>> = {}) => {
  const onSelectPeriod = vi.fn();
  const onRefresh = vi.fn();
  render(
    <WinningTable
      data={LIST[0]}
      periods={LIST.map((item) => item.period)}
      selectedIndex={0}
      onSelectPeriod={onSelectPeriod}
      loading={false}
      onRefresh={onRefresh}
      {...props}
    />,
  );
  return { onSelectPeriod, onRefresh };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 29, 12, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('獎號表', () => {
  test('顯示期別頁籤，點選後切換期別', () => {
    const { onSelectPeriod } = renderTable();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tabs[1]);
    expect(onSelectPeriod).toHaveBeenCalledWith(1);
  });

  test('已過領獎期限的期別在頁籤上標示', () => {
    renderTable();
    const [latest, , oldest] = screen.getAllByRole('tab');
    expect(oldest).toHaveTextContent('已過領獎期限');
    expect(latest).not.toHaveTextContent('已過領獎期限');
  });

  test('顯示領獎期間', () => {
    renderTable();
    expect(screen.getByText('領獎期間：')).toBeInTheDocument();
    expect(screen.getByText(/115\/10\/6 ～ 116\/1\/5/)).toBeInTheDocument();
  });

  test('顯示特別獎、特獎與三組頭獎號碼', () => {
    renderTable();
    for (const number of ['89996565', '91098182', '54348835', '44991397', '06595111']) {
      expect(screen.getByText(number)).toBeInTheDocument();
    }
  });

  test('二獎～六獎說明是與頭獎末幾碼相同', () => {
    renderTable();
    for (const digits of [7, 6, 5, 4, 3]) {
      expect(screen.getByText(`與頭獎末 ${digits} 碼相同`)).toBeInTheDocument();
    }
  });

  test('更新中時按鈕停用', () => {
    const { onRefresh } = renderTable({ loading: true });
    const button = screen.getByRole('button', { name: '更新中' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test('按更新號碼會重新抓取', () => {
    const { onRefresh } = renderTable();
    fireEvent.click(screen.getByRole('button', { name: '更新號碼' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
