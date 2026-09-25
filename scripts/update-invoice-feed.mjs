import { mkdir, readFile, writeFile } from 'node:fs/promises';

const url = 'https://invoice.etax.nat.gov.tw/invoice.xml';
const target = new URL('../public/invoice.xml', import.meta.url);
const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
if (!response.ok) throw new Error(`官方 RSS 回應 ${response.status}`);

const xml = (await response.text()).replace(/\r\n/g, '\n');
const firstItem = xml.match(/<item>[\s\S]*?<\/item>/)?.[0];
const period = firstItem?.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/)?.[1];
const numbers = firstItem?.match(/(?<!\d)\d{8}(?!\d)/g) ?? [];
if (!xml.includes('<rss') || !period || !/\d+年\s*\d+~\d+月/.test(period) || numbers.length < 5) {
  throw new Error('官方 RSS 格式或最新獎號不完整，保留原有快照');
}

let previous = '';
try { previous = await readFile(target, 'utf8'); } catch { /* first run */ }
if (previous === xml) {
  console.log(`獎號快照未變更：${period}`);
} else {
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(target, xml, 'utf8');
  console.log(`獎號快照已更新：${period}`);
}
