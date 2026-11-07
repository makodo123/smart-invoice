import { WinningNumbers } from '../../types';

/** 115 年三期真實開獎號碼（與 services/gemini.ts 的內建備援資料相同） */
export const JUL_AUG: WinningNumbers = {
  period: '115年 07~08月',
  specialPrize: '89996565',
  grandPrize: '91098182',
  firstPrize: ['54348835', '44991397', '06595111'],
  additionalSixthPrize: [],
};

export const MAY_JUN: WinningNumbers = {
  period: '115年 05~06月',
  specialPrize: '38548029',
  grandPrize: '10138845',
  firstPrize: ['24121106', '28589937', '83663333'],
  additionalSixthPrize: [],
};

export const MAR_APR: WinningNumbers = {
  period: '115年 03~04月',
  specialPrize: '19531471',
  grandPrize: '85941329',
  firstPrize: ['07225810', '20231230', '83518781'],
  additionalSixthPrize: [],
};

export const LIST = [JUL_AUG, MAY_JUN, MAR_APR];
