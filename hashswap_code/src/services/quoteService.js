// src/services/quoteService.js
import { quoteXYK } from "../hedera/poolMath.js";

/**
 * Mock reserves for now
 * (sau này sẽ đọc từ mirror / pool account)
 */
const MOCK_RESERVE_A = 1_000_000;
const MOCK_RESERVE_B = 1_000_000;

function pct(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Number((n * 100).toFixed(4)); // %
}

export function getQuote(amountIn, feeBps, slippageBps = 50) {
  const amtIn = Number(amountIn);
  if (!Number.isFinite(amtIn) || amtIn <= 0) {
    throw new Error("amountIn must be > 0");
  }

  const reserveIn = Number(MOCK_RESERVE_A);
  const reserveOut = Number(MOCK_RESERVE_B);
  if (!Number.isFinite(reserveIn) || !Number.isFinite(reserveOut) || reserveIn <= 0 || reserveOut <= 0) {
    throw new Error("invalid mock reserves");
  }

  const fee = Number(feeBps ?? 0);
  if (!Number.isFinite(fee) || fee < 0 || fee > 10_000) {
    throw new Error("feeBps invalid");
  }

  const slip = Number(slippageBps ?? 50);
  if (!Number.isFinite(slip) || slip < 0 || slip > 10_000) {
    throw new Error("slippageBps invalid");
  }

  const midPrice = reserveOut / reserveIn; // before swap

  // ✅ compute amountOut via x*y=k with fee
  const amountOut = quoteXYK({
    reserveIn,
    reserveOut,
    amountIn: amtIn,
    feeBps: fee,
  });

  const out = Number(amountOut);
  if (!Number.isFinite(out) || out < 0) {
    throw new Error("quote failed");
  }

  const executionPrice = amtIn > 0 ? out / amtIn : 0;

  // price impact vs mid price (clamp >= 0)
  const rawImpact = midPrice > 0 ? (midPrice - executionPrice) / midPrice : 0;
  const priceImpact = pct(Math.max(0, rawImpact));

  const feePct = (fee / 100).toFixed(2) + "%"; // 30 bps => 0.30%
  const minOut = out * (1 - slip / 10_000);

  return {
    pair: "hUSD/hEUR",
    amountIn: amtIn,
    amountOut: out,
    minOut,
    slippageBps: slip,

    feeBps: fee,
    feePct,

    reserveIn,
    reserveOut,

    midPrice,          // reserveOut/reserveIn
    executionPrice,    // amountOut/amountIn
    priceImpactPct: priceImpact,
  };
}