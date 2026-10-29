/** 財政部統一發票說明（領獎地點、應備文件、期限） */
export const OFFICIAL_CLAIM_INFO_URL = 'https://invoice.etax.nat.gov.tw/';

export interface NetPrize {
  gross: number;
  /** 所得稅：獎金超過 5,000 元扣 20% */
  incomeTax: number;
  /** 印花稅：獎金 4,000 元以上扣 0.4% */
  stampTax: number;
  net: number;
}

/** 預估實拿金額（例如頭獎 20 萬實拿 159,200 元）；實際以領獎時為準 */
export const estimateNetPrize = (gross: number): NetPrize => {
  const incomeTax = gross > 5000 ? Math.round(gross * 0.2) : 0;
  const stampTax = gross >= 4000 ? Math.round(gross * 0.004) : 0;
  return { gross, incomeTax, stampTax, net: gross - incomeTax - stampTax };
};
