# 統一發票智能對獎

> 用手機拍發票、輸入號碼，或在設定 Gmail 授權後掃描電子發票，對照財政部開獎資料。

---

## 為什麼做這個

每雙月對發票既麻煩又容易漏掉。手動查獎號要開好幾個頁面，電子發票寄到 Gmail 更是淹沒在收件匣裡。這個工具整合三種對獎方式，讓對發票變成不到 30 秒的事。

---

## 功能

- **獎號更新** — 優先讀取每日更新的財政部官方 RSS 快照，並支援切換期別；來源無法連線時使用快取或內建備援資料
- **手動輸入對獎** — 輸入發票末三碼或完整號碼，比對選取的期別與前一期；只輸入部分號碼時會提示「至少 X 獎，請核對完整號碼」
- **中獎後的領獎說明** — 顯示預估實拿金額（扣 20% 所得稅、0.4% 印花稅）、應備文件、領獎期間，並連到財政部說明
- **歷史紀錄自動重新對獎** — 對獎時尚未開獎的期別，開獎後再開啟網頁會自動補對獎，有新結果時提示
- **QR Code / 相機辨識** — 支援電子發票 QR Code 即時相機取景與圖片掃描（毫秒級對獎、免 API 即可用）；依發票日期自動選擇對獎期別，支援連續掃描一疊發票；若有設定 Gemini API 亦支援實體發票 AI 圖片辨識備援
- **Gmail 自動對獎** — 授權後掃描收件匣中的電子發票，批次比對結果一次顯示
- **歷史紀錄** — 可只看中獎、刪除單筆；匯出掃描過的發票（CSV）
- **加到主畫面** — 提供 Web App Manifest 與圖示，手機可加到主畫面像 App 一樣開啟

---

## 技術架構

| 分類 | 技術 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 建置工具 | Vite |
| 樣式 | Tailwind CSS（建置時產生，不使用 CDN） |
| AI 圖片辨識 | Gemini Vision API |
| 獎號資料 | 財政部電子發票整合服務平台（官方 RSS）|
| Gmail 整合 | Google OAuth 2.0 + Gmail API |

---

## 本機執行

**前置需求**：Node.js 18+。手動輸入與 QR Code 對獎不需要 Gemini API Key；AI 圖片辨識需要設定金鑰。

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

> **Gemini 金鑰安全性**：打包進前端的金鑰任何人都能從網頁原始碼取得，所以 `npm run build` 預設**不會**把 `GEMINI_API_KEY` 打包進去（`npm run dev` 仍會使用）。正式版的使用者可以在「快速對獎」區塊自行輸入自己的金鑰（只存在該瀏覽器）。若已在 Google Cloud 限制金鑰可用的網域，仍想打包進去，請設定 `GEMINI_EMBED_KEY=true`。

### Gmail 自動對獎設定

1. 在 Google Cloud 專案啟用 Gmail API，並建立「網頁應用程式」OAuth Client ID。
2. 在 Authorized JavaScript origins 加入正式網址 `https://makodo123.github.io`，開發時再加入 `http://localhost:3000` 與 `http://127.0.0.1:3000`。
3. 正式版的 Client ID 已寫在 `.env.production`（`npm run build` 會自動讀取）。本機開發請在 `.env.local` 設定 `VITE_GOOGLE_CLIENT_ID`，並重啟開發伺服器。

Client ID 是公開資訊，可以提交進 repo；保護它的是上面的 Authorized JavaScript origins。本專案在瀏覽器內取得權杖，不使用也不需要 Client Secret。

`gmail.readonly` 屬於 Google 的受限範圍：OAuth 同意畫面為「測試中」時，只有加入「測試使用者」的帳號（上限 100 個）可以登入；要開放給所有人需通過 Google 審核。

Gmail 掃描只會在使用者按下授權與掃描後執行，使用 `gmail.readonly` 權限；存取權杖不會寫入磁碟。

### 測試

```bash
npm test
```

`tests/checkLogic.test.ts` 以 6 期財政部真實開獎號碼（`tests/fixtures/` 的固定快照）測試對獎邏輯，將 `checkInvoice` 的結果與依官方給獎規則獨立實作的比對函式核對，共 24,132 組：

| 項目 | 組數 |
|---|---|
| 特別獎、特獎完整 8 碼 | 12 |
| 頭獎～六獎邊界（與頭獎末 k 碼相同、第 k+1 碼不同） | 108 |
| 只和特別獎／特獎末 7 碼相同（應不得獎） | 12 |
| 末三碼 000–999 窮舉 | 6,000 |
| 隨機 8 碼號碼交叉比對（固定亂數種子） | 18,000 |

`tests/usability.test.ts` 測試使用情境：部分號碼「至少 X 獎」提示、依發票日期選擇期別、期別交界、領獎期限、QR Code 與 Gmail 日期解析、CSV 匯出，歷史紀錄不被覆蓋，以及新一期開獎後自動重新對獎歷史紀錄。

---

## 資料來源

發票獎號資料來自[財政部電子發票整合服務平台](https://www.einvoice.nat.gov.tw/)的[官方 RSS](https://invoice.etax.nat.gov.tw/invoice.xml)。排程每天擷取官方 RSS，寫入 `public/invoice.xml`；網站優先讀取 GitHub 上的快照，無法取得時才使用本機快照、快取或內建備援資料。備援資料可能不是最新期別，對獎結果請以財政部公告為準。圖片辨識由 Google Gemini 提供。

---

## License

MIT
