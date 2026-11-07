// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LIST } from './fixtures';

// 以假的 Gmail 連線取代真的 Google 登入與 API：登入後回傳一封 5–6 月期中頭獎的發票信
vi.mock('../../services/gmail', () => {
  let onToken: ((token: string) => void) | null = null;
  return {
    GmailAuthError: class GmailAuthError extends Error {},
    initTokenClient: (_clientId: string, callback: (token: string) => void) => { onToken = callback; },
    requestAccessToken: () => onToken?.('test-token'),
    revokeAccessToken: async () => {},
    fetchInvoiceEmails: async () => [{ id: 'm1', snippet: '', internalDate: '' }],
    fetchMessageDetails: async () => ({
      id: 'm1',
      snippet: '',
      internalDate: String(new Date(2026, 5, 10, 12).getTime()),
      subject: '電子發票開立通知',
      invoiceDate: '2026/06/10',
      invoices: [{ parsedNumber: '24121106', fullNumber: 'AB24121106' }],
      parsedNumber: '24121106',
      fullNumber: 'AB24121106',
      attachmentErrors: 0,
      protectedAttachments: 0,
    }),
  };
});

const renderAndScan = async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client.apps.googleusercontent.com');
  vi.resetModules();
  const { default: GmailCheckSection } = await import('../../components/GmailCheckSection');
  render(<GmailCheckSection winningNumbersList={LIST} selectedIndex={0} />);
  fireEvent.click(screen.getByRole('button', { name: '連結 Gmail 並自動對獎' }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('Gmail 掃描結果', () => {
  test('領獎期限內的中獎發票顯示獎金', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 12, 0));
    await renderAndScan();
    expect(await screen.findByText(/掃描完成/)).toBeInTheDocument();
    // 中獎清單與掃描明細表都會列出這張發票
    expect(screen.getAllByText('AB24121106')).toHaveLength(2);
    expect(screen.getByText('頭獎 (20萬)')).toBeInTheDocument();
    expect(screen.getByText('$200,000')).not.toHaveClass('line-through');
    expect(screen.getByText(/其中 1 張中獎或疑似中獎。/)).toBeInTheDocument();
  });

  test('已過領獎期限的中獎發票標示清楚，掃描摘要也提醒', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0));
    await renderAndScan();
    expect(await screen.findByText('頭獎 (20萬)・已過領獎期限')).toBeInTheDocument();
    expect(screen.getByText('$200,000')).toHaveClass('line-through');
    expect(screen.getByText(/其中 1 張中獎或疑似中獎（1 張已過領獎期限）/)).toBeInTheDocument();
  });
});
