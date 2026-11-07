// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LIST } from './fixtures';

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
};

/** Client ID 在模組載入時讀取，所以先設定環境變數再載入元件 */
const renderGmail = async (clientId: string) => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', clientId);
  vi.resetModules();
  const { default: GmailCheckSection } = await import('../../components/GmailCheckSection');
  render(<GmailCheckSection winningNumbersList={LIST} selectedIndex={0} />);
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
  setOnline(true);
});

describe('Gmail 對獎畫面', () => {
  test('網站沒有設定 Client ID：說明尚未開放，不顯示連結按鈕', async () => {
    await renderGmail('');
    expect(screen.getByText(/此網站尚未開放 Gmail 對獎/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '連結 Gmail 並自動對獎' })).not.toBeInTheDocument();
  });

  test('有設定 Client ID：顯示「對獎」用詞、連結按鈕與雲端發票提醒', async () => {
    await renderGmail('test-client.apps.googleusercontent.com');
    expect(screen.getByRole('heading', { name: 'Gmail 自動對獎' })).toBeInTheDocument();
    expect(screen.queryByText(/兌獎/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Gmail 並自動對獎' })).toBeEnabled();
    expect(screen.getByText(/雲端發票中獎時，財政部會主動通知/)).toBeInTheDocument();
  });

  test('進階搜尋設定預設收合', async () => {
    await renderGmail('test-client.apps.googleusercontent.com');
    const details = screen.getByText(/進階搜尋設定/).closest('details');
    expect(details).not.toHaveAttribute('open');
  });

  test('離線時停用連結按鈕並說明需要網路', async () => {
    setOnline(false);
    await renderGmail('test-client.apps.googleusercontent.com');
    expect(screen.getByText(/目前離線，Gmail 對獎需要網路/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Gmail 並自動對獎' })).toBeDisabled();
  });

  test('網路恢復後自動解除停用', async () => {
    setOnline(false);
    await renderGmail('test-client.apps.googleusercontent.com');
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/目前離線/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Gmail 並自動對獎' })).toBeEnabled();
  });
});
