// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QrScannerModal } from '../../components/QrScannerModal';

const renderModal = (isOpen = true) => {
  const onClose = vi.fn();
  render(<QrScannerModal isOpen={isOpen} onClose={onClose} onScanSuccess={() => null} hasApiKey={false} />);
  return { onClose };
};

beforeEach(() => {
  // 測試環境沒有相機，元件會記錄「Camera access failed」；這是預期的，不顯示在測試輸出
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('QR Code 掃描視窗', () => {
  test('沒開啟時不顯示', () => {
    renderModal(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('無法使用相機時說明原因，並提供重新啟動與上傳照片', async () => {
    // 測試環境沒有相機（navigator.mediaDevices 不存在）
    renderModal();
    expect(await screen.findByText(/無法存取相機/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新啟動相機' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /從相簿\/檔案選擇/ })).toBeInTheDocument();
  });

  test('提示掃描左側 QR Code', () => {
    renderModal();
    expect(screen.getByRole('status')).toHaveTextContent('請對準電子發票「左側」QR Code');
  });

  test('連續掃描的設定會記住', () => {
    renderModal();
    const checkbox = screen.getByRole('checkbox', { name: /連續掃描/ });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(localStorage.getItem('qr_continuous_mode')).toBe('true');

    cleanup();
    renderModal();
    expect(screen.getByRole('checkbox', { name: /連續掃描/ })).toBeChecked();
  });

  test('關閉按鈕與取消按鈕都會關閉視窗', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: '關閉掃描視窗' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
