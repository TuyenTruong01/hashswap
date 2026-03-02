// src/services/swapService.js
import { buildScheduledTransferCreate, executeSchedule, getPoolReserves } from "./txService.js";
import { quoteXYK } from "../hedera/poolMath.js";
import { resolveTokenId } from "../hedera/hts.js";

export async function buildSwap({ CONFIG, userAccountId, from, to, amountIn, slippageBps = 50 }) {
  if (from === to) throw new Error("from/to must be different");
  if (!["hUSD","hEUR"].includes(from) || !["hUSD","hEUR"].includes(to)) {
    throw new Error("only hUSD/hEUR supported in v1");
  }

  const { reserveHUSD, reserveHEUR, decHUSD, decHEUR } = await getPoolReserves({ CONFIG });

  const feeBps = CONFIG.pool.feeBps ?? 30;

  // reserves in/out
  const reserveIn = from === "hUSD" ? reserveHUSD : reserveHEUR;
  const reserveOut = to === "hEUR" ? reserveHEUR : reserveHUSD;

  const amtInHuman = Number(amountIn);
  if (!Number.isFinite(amtInHuman) || amtInHuman <= 0) throw new Error("amountIn must be > 0");

  const out = quoteXYK({ reserveIn, reserveOut, amountIn: amtInHuman, feeBps });
  const minOut = out * (1 - Number(slippageBps) / 10_000);

  const tokenIn = resolveTokenId(CONFIG, from);
  const tokenOut = resolveTokenId(CONFIG, to);

  const decIn = from === "hUSD" ? decHUSD : decHEUR;
  const decOut = to === "hUSD" ? decHUSD : decHEUR;

  const poolAcc = CONFIG.pool.accountId;

  const amtInInt = Math.floor(amtInHuman * Math.pow(10, decIn));
  const amtOutInt = Math.floor(minOut * Math.pow(10, decOut));

  if (amtInInt <= 0) throw new Error("amountIn too small");
  if (amtOutInt <= 0) throw new Error("minOut too small");

  const innerTransfers = [
    // user -> pool (in)
    { tokenId: tokenIn, accountId: userAccountId, amountInt: -amtInInt },
    { tokenId: tokenIn, accountId: poolAcc,      amountInt: +amtInInt },

    // pool -> user (out)
    { tokenId: tokenOut, accountId: poolAcc,      amountInt: -amtOutInt },
    { tokenId: tokenOut, accountId: userAccountId, amountInt: +amtOutInt },
  ];

  const built = await buildScheduledTransferCreate({
    CONFIG,
    payerAccountId: userAccountId,
    innerTransfers,
    memo: `HashSwap: swap ${from}->${to}`,
  });

  return {
    ...built,
    quote: {
      amountOut: out,
      minOut,
      slippageBps: Number(slippageBps),
    },
  };
}

export async function executeSwap({ scheduleId }) {
  return executeSchedule({ scheduleId });
}