# 統一發票智能對獎

> 用手機拍發票、輸入號碼、或直接掃描 Gmail，一鍵對照財政部最新獎號。

---

## 為什麼做這個

每雙月對發票既麻煩又容易漏掉。手動查獎號要開好幾個頁面，電子發票寄到 Gmail 更是淹沒在收件匣裡。這個工具整合三種對獎方式，讓對發票變成不到 30 秒的事。

---

## 功能

- **即時獎號** — 自動從財政部電子發票整合服務平台抓取最新兩期獎號，支援切換期別
- **手動輸入對獎** — 輸入發票末三碼或完整號碼，即時比對所有獎項
- **QR Code / 相機辨識** — 支援電子發票 QR Code 即時相機取景與圖片掃描（毫秒級對獎、免 API 即可用）；若有設定 Gemini API 亦支援實體發票 AI 圖片辨識備援
- **Gmail 自動對獎** — 授權後掃描收件匣中的電子發票，批次比對結果一次顯示

---

## 技術架構

| 分類 | 技術 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 建置工具 | Vite |
| 樣式 | Tailwind CSS |
| AI 圖片辨識 | Gemini Vision API |
| 獎號資料 | 財政部電子發票整合服務平台（官方公開 API）|
| Gmail 整合 | Google OAuth 2.0 + Gmail API |

---

## 本機執行

**前置需求**：Node.js 18+、Gemini API Key

```bash
git clone https://github.com/makodo123/smart-invoice.git
cd smart-invoice
npm install
```

建立 `.env.local`：

```
GEMINI_API_KEY=你的金鑰
VITE_GOOGLE_CLIENT_ID=你的GoogleOAuth網頁用戶端ID
```

```bash
npm run dev
```

### Gmail 自動兌獎設定

1. 在 Google Cloud 專案啟用 Gmail API，並建立「網頁應用程式」OAuth Client ID。
2. 在 Authorized JavaScript origins 加入 `http://localhost:3000` 與 `http://127.0.0.1:3000`。
3. 將 Client ID 設定為 `.env.local` 的 `VITE_GOOGLE_CLIENT_ID`，重啟開發伺服器。

Gmail 掃描只會在使用者按下授權與掃描後執行，使用 `gmail.readonly` 權限；存取權杖不會寫入磁碟。

---

## 資料來源

發票獎號資料來自[財政部電子發票整合服務平台](https://www.einvoice.nat.gov.tw/)公開 API，圖片辨識由 Google Gemini 提供。

---

## License

MIT
