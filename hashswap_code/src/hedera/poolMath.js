// src/hedera/poolMath.js
export function quoteXYK({ reserveIn, reserveOut, amountIn, feeBps }) {
  const fee = Number(feeBps ?? 0);
  const amtIn = Number(amountIn ?? 0);
  if (amtIn <= 0) return 0;

  const amountInWithFee = amtIn * (10000 - fee) / 10000;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;
  const amountOut = numerator / denominator;
  return amountOut;
}