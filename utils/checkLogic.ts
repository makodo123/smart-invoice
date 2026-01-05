import { WinningNumbers, PrizeType, CheckResult } from '../types';

const getPrizeAmount = (type: PrizeType): number => {
  switch (type) {
    case PrizeType.Special: return 10000000;
    case PrizeType.Grand: return 2000000;
    case PrizeType.First: return 200000;
    case PrizeType.Second: return 40000;
    case PrizeType.Third: return 10000;
    case PrizeType.Fourth: return 4000;
    case PrizeType.Fifth: return 1000;
    case PrizeType.Sixth: return 200;
    default: return 0;
  }
};

export const checkInvoice = (userNumber: string, winning: WinningNumbers, isCurrentPeriod: boolean = false): CheckResult => {
  const num = userNumber.trim();
  const baseResult = { period: winning.period, isCurrentPeriod };
  
  if (num.length < 3) {
    return { ...baseResult, isMatch: false, prizeType: PrizeType.None, amount: 0, description: "請輸入至少後 3 碼" };
  }

  // 1. Check Special Prize (特別獎)
  if (winning.specialPrize === num) {
    // Exact match 8 digits
    return { 
      ...baseResult,
      isMatch: true, 
      prizeType: PrizeType.Special, 
      amount: getPrizeAmount(PrizeType.Special),
      matchedNumber: winning.specialPrize 
    };
  } else if (winning.specialPrize.endsWith(num)) {
    // Partial match (suffix) for Special Prize
    // Only warn if they entered at least 3 digits but less than 8
    return {
      ...baseResult,
      isMatch: true,
      isPartial: true,
      prizeType: PrizeType.Special,
      amount: 0,
      matchedNumber: winning.specialPrize,
      description: "與特別獎末碼相同，請核對 8 碼"
    };
  }

  // 2. Check Grand Prize (特獎)
  if (winning.grandPrize === num) {
    return { 
      ...baseResult,
      isMatch: true, 
      prizeType: PrizeType.Grand, 
      amount: getPrizeAmount(PrizeType.Grand),
      matchedNumber: winning.grandPrize 
    };
  } else if (winning.grandPrize.endsWith(num)) {
    // Partial match (suffix) for Grand Prize
    return {
      ...baseResult,
      isMatch: true,
      isPartial: true,
      prizeType: PrizeType.Grand,
      amount: 0,
      matchedNumber: winning.grandPrize,
      description: "與特獎末碼相同，請核對 8 碼"
    };
  }

  // 3. Check First Prize & Sub-prizes (頭獎 ~ 六獎)
  let bestMatch: CheckResult | null = null;
  
  const getRank = (type: PrizeType) => {
    switch (type) {
      case PrizeType.First: return 1;
      case PrizeType.Second: return 2;
      case PrizeType.Third: return 3;
      case PrizeType.Fourth: return 4;
      case PrizeType.Fifth: return 5;
      case PrizeType.Sixth: return 6;
      default: return 99;
    }
  };

  for (const first of winning.firstPrize) {
    let matchCount = 0;
    const maxLen = Math.min(num.length, first.length);
    
    // Calculate matching suffix length
    for (let i = 1; i <= maxLen; i++) {
      if (num[num.length - i] === first[first.length - i]) {
        matchCount++;
      } else {
        break;
      }
    }

    let currentResult: CheckResult | null = null;

    if (matchCount === 8) {
      currentResult = { ...baseResult, isMatch: true, prizeType: PrizeType.First, amount: getPrizeAmount(PrizeType.First), matchedNumber: first }; 
    } else if (matchCount === 7) {
      currentResult = { ...baseResult, isMatch: true, prizeType: PrizeType.Second, amount: getPrizeAmount(PrizeType.Second), matchedNumber: first }; 
    } else if (matchCount === 6) {
      currentResult = { ...baseResult, isMatch: true, prizeType: PrizeType.Third, amount: getPrizeAmount(PrizeType.Third), matchedNumber: first }; 
    } else if (matchCount === 5) {
      currentResult = { ...baseResult, isMatch: true, prizeType: PrizeType.Fourth, amount: getPrizeAmount(PrizeType.Fourth), matchedNumber: first }; 
    } else if (matchCount === 4) {
      currentResult = { ...baseResult, isMatch: true, prizeType: PrizeType.Fifth, amount: getPrizeAmount(PrizeType.Fifth), matchedNumber: first }; 
    } else if (matchCount === 3) {
      currentResult = { ...baseResult, isMatch: true, prizeType: PrizeType.Sixth, amount: getPrizeAmount(PrizeType.Sixth), matchedNumber: first, description: "符合頭獎後三碼 (六獎)" };
    }

    if (currentResult) {
      if (!bestMatch || getRank(currentResult.prizeType) < getRank(bestMatch.prizeType)) {
        bestMatch = currentResult;
      }
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  // 4. Additional Sixth Prize (增開六獎) - Match last 3
  if (winning.additionalSixthPrize) {
    for (const add6 of winning.additionalSixthPrize) {
      if (num.endsWith(add6)) {
         return { 
           ...baseResult,
           isMatch: true, 
           prizeType: PrizeType.Sixth, 
           amount: getPrizeAmount(PrizeType.Sixth),
           matchedNumber: add6, 
           description: "增開六獎" 
         };
      }
    }
  }

  return { ...baseResult, isMatch: false, prizeType: PrizeType.None, amount: 0 };
};