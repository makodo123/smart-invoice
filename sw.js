/*
 * 離線使用：
 * - 頁面（index.html）網路優先，有網路就拿最新版；離線或逾時才用上次存下的版本。
 * - 打包後的 JS/CSS（檔名含雜湊，內容不會變）、圖示與 manifest：存過就直接用。
 * - 獎號資料（invoice.xml）、Gmail、Gemini 等請求不經過這裡，離線時由程式改用 localStorage 的獎號。
 * 修改這個檔案時請更新 VERSION，瀏覽器才會換上新的 Service Worker。
 */
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const MAX_ASSETS = 60;
const NAVIGATION_TIMEOUT_MS = 4000;

const SCOPE = self.registration.scope; // 例如 https://makodo123.github.io/smart-invoice/
const STATIC_FILES = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

const isAssetRequest = (url) =>
  url.href.startsWith(`${SCOPE}assets/`) || STATIC_FILES.some((file) => url.href === `${SCOPE}${file}`);

/** 從頁面 HTML 找出它引用的打包檔案，安裝時先存起來，第一次離線就能開 */
const referencedAssets = (html) =>
  [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], SCOPE))
    .filter(isAssetRequest)
    .map((url) => url.href);

// 打包檔名含雜湊、內容不變，所以只比對網址，忽略 Vary（模組 script 的請求會多帶 Origin 標頭，否則會對不到快取）
const MATCH_OPTIONS = { ignoreVary: true };

const trimCache = async (cache) => {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)));
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(SCOPE, { cache: 'no-store' });
    if (!response.ok) return;
    const html = await response.clone().text();
    await (await caches.open(SHELL_CACHE)).put(SCOPE, response);
    const assets = await caches.open(ASSET_CACHE);
    await assets.addAll([...new Set([...referencedAssets(html), ...STATIC_FILES.map((file) => `${SCOPE}${file}`)])]);
  })().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, ASSET_CACHE];
    await Promise.all((await caches.keys()).filter((key) => !keep.includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

const handleNavigation = async (request) => {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(SCOPE, response.clone());
    return response;
  });
  network.catch(() => {}); // 已改用快取頁面時，網路失敗不需要再處理
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS));
  try {
    // 網路太慢時先用存下的頁面，網路回應後仍會更新快取，下次開啟就是新版
    const response = await Promise.race([network, timeout]);
    if (response) return response;
    return (await cache.match(SCOPE, MATCH_OPTIONS)) || (await network);
  } catch {
    return (await cache.match(SCOPE, MATCH_OPTIONS)) || Response.error();
  }
};

const handleAsset = async (request) => {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request.url, MATCH_OPTIONS);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request.url, response.clone());
    trimCache(cache);
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.href.startsWith(SCOPE)) {
    event.respondWith(handleNavigation(request));
  } else if (isAssetRequest(url)) {
    event.respondWith(handleAsset(request));
  }
});
